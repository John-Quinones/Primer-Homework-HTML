// Numbering of generated documents (version 2.2.58, John 26/10/2026): every contract gets the next number from No. 2.326 and every
// power of attorney from No. 10.222 and every memorial from No. 12.325 (version 2.2.66), whether or not it is saved in the case. Shared by the server and the published link.
export const DOC_START = { contrato: 2326, poder: 10222, memorial: 12325 };
const KIND_OF_CATEGORY = { Contrato: "contrato", Poder: "poder", Memorial: "memorial" };
export const DOC_KIND_NAME = { contrato: "Contrato", poder: "Poder", memorial: "Memorial" };
/** "contrato" / "poder" for a template category that is numbered, "" for the others. */
export const docKindOf = (category) => KIND_OF_CATEGORY[category] || "";
/** 2326 → "2.326", 10222 → "10.222" */
export const formatDocNumber = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/** The number after the last one issued (never below the starting number of the kind). */
export const nextDocNumber = (last, kind) => Math.max(Number(last) || 0, DOC_START[kind] - 1) + 1;
