-- The same business must not be added twice. Until now every upload path
-- compared the raw "name|address" text, so "התיבונים 7, ירושלים" and
-- "התיבונים 7" (or ד"ר with " vs ״) counted as two businesses.
--
-- business_dedup_key(name, address) builds the same key as
--   src/lib/businessKey.ts · scripts/arnona_common.py · vercel-relay/lib/businessKey.js
-- (keep them in sync): name words without quotes, punctuation, titles and
-- "בע"מ", sorted · street key (no prefixes, words sorted) · house number.
--
-- Every new row gets its key in businesses.dedup_key, and an insert whose key
-- is already taken is skipped (not an error), whichever path sent it — the
-- site, the GitHub workflow, the relay or a future one. Existing duplicates
-- are left as they are; they are reviewed by hand.
--
-- Purely additive: a new column, functions, an index and a trigger.

create or replace function public.business_tidy_address(address text)
returns text
language plpgsql
immutable
as $$
declare
  a text := btrim(regexp_replace(coalesce(address, ''), '\s+', ' ', 'g'));
begin
  for i in 1..2 loop
    exit when a !~* '(^|[\s,])(ירושלים|jerusalem)\s*$';
    a := btrim(regexp_replace(regexp_replace(a, '(^|[\s,])(ירושלים|jerusalem)\s*$', '', 'i'), '[\s,]+$', ''));
  end loop;
  return a;
end;
$$;

create or replace function public.business_address_key(address text)
returns text
language plpgsql
immutable
as $$
declare
  base   text := btrim(split_part(public.business_tidy_address(address), ',', 1));
  m      text[];
  street text;
  num    text;
  p      text;
begin
  -- cleanAddress() in src/lib/geocode.ts
  foreach p in array array['רחוב ', 'רח'' ', 'שדרות ', 'שד'' ', 'שד ', 'סמטת ', 'כיכר ', 'גן ', 'מעלה ', 'מורד '] loop
    if starts_with(base, p) then base := substr(base, length(p) + 1); exit; end if;
  end loop;
  base := btrim(regexp_replace(base, '\s+', ' ', 'g'));
  base := btrim(regexp_replace(base, '\s+(דירה|דיר|דר|יח''|יחידה|קומה)\s+[0-9]+.*$', '', 'i'));
  -- parseAddress() in src/lib/geocode.ts
  m := regexp_match(base, '^(.*?[^0-9])\s*([0-9]+)(?:\s*[א-ת]|\s*/\s*[0-9א-ת]+)?(?:\s+.*)?$');
  if m is null then
    street := btrim(base); num := '';
  else
    street := btrim(m[1]); num := case when m[2] = '0' then '' else m[2] end;
  end if;
  -- streetKey() in src/lib/businessKey.ts
  street := regexp_replace(street, '["''`׳״’]', '', 'g');
  street := btrim(regexp_replace(replace(street, '-', ' '), '\s+', ' ', 'g'));
  street := btrim(regexp_replace(street, '\s+סמ\s*[0-9]+$', ''));
  foreach p in array array['שכ ', 'שכונת ', 'דרך ', 'רחוב ', 'שדרות ', 'שד ', 'הרבנית ', 'הרב ', 'האדמור ', 'רבי ', 'ר '] loop
    if starts_with(street, p) then street := substr(street, length(p) + 1); end if;
  end loop;
  select coalesce(string_agg(w, ' ' order by w collate "C"), '') into street
    from unnest(string_to_array(street, ' ')) w where w <> '';
  return street || '|' || num;
end;
$$;

create or replace function public.business_name_key(name text)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(w, ' ' order by w collate "C"), '')
    from (
      select distinct w
        from unnest(string_to_array(
               btrim(regexp_replace(
                 regexp_replace(
                   regexp_replace(lower(coalesce(name, '')), '["''`׳״’]', '', 'g'),
                   '(?<=[[:alpha:]])\.(?=[[:alpha:]])', '', 'g'),
                 '[^[:alnum:]]+', ' ', 'g')),
               ' ')) w
       where w <> ''
         and w <> all (array['בעמ', 'בע', 'מ', 'דר', 'עוד', 'עו', 'פרופ', 'פרופסור', 'רוח', 'מר', 'גב', 'הרב', 'ltd', 'inc', 'dr'])
    ) words
$$;

create or replace function public.business_dedup_key(name text, address text)
returns text
language sql
immutable
as $$
  select public.business_name_key(name) || '#' || public.business_address_key(address)
$$;

alter table public.businesses add column if not exists dedup_key text;
update public.businesses set dedup_key = public.business_dedup_key(name, address)
 where dedup_key is distinct from public.business_dedup_key(name, address);
create index if not exists businesses_dedup_key_idx on public.businesses (dedup_key);

create or replace function public.businesses_set_dedup_key()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.dedup_key := business_dedup_key(new.name, new.address);
  if tg_op = 'INSERT' and exists (
    select 1 from businesses where dedup_key = new.dedup_key and id <> new.id
  ) then
    raise notice 'business skipped, already exists: % / %', new.name, new.address;
    return null; -- skip the row; the rest of the batch is saved
  end if;
  return new;
end;
$$;

-- Named to run before businesses_normalize_type, so a skipped duplicate
-- never adds its type to the list.
drop trigger if exists businesses_dedup on public.businesses;
create trigger businesses_dedup
  before insert or update of name, address on public.businesses
  for each row execute function public.businesses_set_dedup_key();
