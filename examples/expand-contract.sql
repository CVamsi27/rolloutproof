ALTER TABLE users ADD COLUMN full_name text;
UPDATE users SET full_name = name;
ALTER TABLE users ALTER COLUMN full_name SET NOT NULL;
