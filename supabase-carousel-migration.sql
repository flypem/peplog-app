-- Adds carousel support: scheduled_posts now stores an array of image URLs
-- instead of a single one. A single-image post is just an array of 1.
-- Run this in Supabase SQL Editor.

alter table scheduled_posts add column if not exists image_urls text[];

-- Backfill: wrap any existing single image_url into the new array column.
update scheduled_posts
set image_urls = ARRAY[image_url]
where image_urls is null and image_url is not null;
