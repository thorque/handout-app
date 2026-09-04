import { randomInt } from "node:crypto";

// Lowercase letters and digits with the look-alikes l, o, 0, 1 removed. See
// docs/adr/0001-ten-character-addresses.md.
export const ADDRESS_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export const ADDRESS_LENGTH = 10;
export const ADDRESS_PATTERN = /^[a-km-np-z2-9]{10}$/;

export function generateAddress() {
  let address = "";
  for (let i = 0; i < ADDRESS_LENGTH; i += 1) {
    address += ADDRESS_ALPHABET[randomInt(0, ADDRESS_ALPHABET.length)];
  }
  return address;
}

const MAX_CLAIM_ATTEMPTS = 5;

export async function claimAddress(client, handoutId) {
  for (let attempt = 1; attempt <= MAX_CLAIM_ATTEMPTS; attempt += 1) {
    const value = generateAddress();
    try {
      await client.query(
        "insert into address (value, handout_id) values ($1, $2)",
        [value, handoutId],
      );
      return value;
    } catch (err) {
      if (err && err.code === "23505" && attempt < MAX_CLAIM_ATTEMPTS) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("Could not claim a unique address");
}
