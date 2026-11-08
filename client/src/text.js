// Recover UTF-8 bytes that were incorrectly decoded as Windows-1252/Latin-1.
// Only accept a complete, valid UTF-8 sequence; preserve normal Vietnamese.
const windows1252 = new Map(Array.from("€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ", (char, index) => [char, 0x80 + index]));
const utf8 = new TextDecoder("utf-8", { fatal: true });

function repairEncoding(text) {
  return text.replace(/\S+/gu, token => {
    let repaired = token;
    for (let pass = 0; pass < 3; pass++) {
      const bytes = [];
      for (const char of repaired) {
        const code = windows1252.get(char) ?? char.codePointAt(0);
        if (code > 255) return repaired;
        bytes.push(code);
      }
      try {
        const decoded = utf8.decode(new Uint8Array(bytes));
        if (decoded === repaired) break;
        repaired = decoded;
      } catch {
        break;
      }
    }
    return repaired;
  });
}

// Decode legacy text as plain text. React still escapes the result.
export function cleanText(value) {
  let text = String(value ?? "");
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  for (let pass = 0; pass < 3; pass++) {
    const decoded = text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
      const hex = entity[1].toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code) : match;
    });
    if (decoded === text) break;
    text = decoded;
  }
  return repairEncoding(text).normalize("NFC").trim();
}
