exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    alter table handout add column owner_email text;
  `);
  // A note, not an identity: `owner` alone decides who may see a handout.
  // This column exists so that an operator who moves the installation to a
  // different identity provider can tell whose handouts are whose — every
  // `owner` changes in that move and there is no user table to migrate.
  // Nullable on purpose: rows written before this column existed have no
  // email, and a provider is not obliged to hand one over at all.
  // See docs/adr/0017-the-owners-email-is-recorded-as-a-note.md.
};

exports.down = (pgm) => {
  pgm.sql(`
    alter table handout drop column owner_email;
  `);
};
