// Typed access to the country and regulation taxonomies.

import countriesData from "./countries.json";
import regulationsData from "./regulations.json";

export type Country = { id: string; name: string };
export type RegulationKind = "regulation" | "directive" | "standard";
export type Regulation = {
  id: string;
  name: string;
  reference: string;
  kind: RegulationKind;
};

export const countries = countriesData as Country[];
export const regulations = regulationsData as Regulation[];

export function findCountry(id: string | null | undefined): Country | null {
  if (!id) return null;
  return countries.find((c) => c.id === id) ?? null;
}

export function findRegulation(id: string | null | undefined): Regulation | null {
  if (!id) return null;
  return regulations.find((r) => r.id === id) ?? null;
}
