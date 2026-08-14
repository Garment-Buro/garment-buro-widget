export type PersonAssetVariant = "full" | "avatar";

const personAssets: Record<string, Record<PersonAssetVariant, string>> = {
  "вера": {
    full: "/assets/people/vera-full.png",
    avatar: "/assets/people/vera-avatar.png"
  },
  "никита": {
    full: "/assets/people/nikita-full.png",
    avatar: "/assets/people/nikita-avatar.png"
  }
};

export function personAsset(name: string, variant: PersonAssetVariant): string | undefined {
  return personAssets[normalizePersonName(name)]?.[variant];
}

export function normalizePersonName(name: string): string {
  return name.trim().toLocaleLowerCase("ru-RU");
}

export function samePerson(left: string, right: string): boolean {
  return Boolean(left.trim() && right.trim() && normalizePersonName(left) === normalizePersonName(right));
}
