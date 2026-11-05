CREATE TABLE users (
  id integer PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL CONSTRAINT users_status_check CHECK (status IN ('active', 'paused'))
);
