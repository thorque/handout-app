exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    create table handout (
      id         uuid primary key default gen_random_uuid(),
      title      text not null,
      owner      text not null,
      password   text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table address (
      id         uuid primary key default gen_random_uuid(),
      value      text not null unique,
      handout_id uuid references handout(id) on delete set null,
      created_at timestamptz not null default now()
    );

    create index address_handout_id_idx on address (handout_id);
  `);
  // password stays null until HANDOUT-8 adds a way to set it.
};

exports.down = (pgm) => {
  pgm.sql(`
    drop table address;
    drop table handout;
  `);
};
