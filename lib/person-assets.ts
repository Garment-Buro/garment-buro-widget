export type PersonAssetVariant = "full" | "avatar";

const personAssets: Record<string, Record<PersonAssetVariant, string>> = {
  "вера": {
    full: "/assets/people/vera-full.png",
    avatar: "/assets/people/vera-avatar.png"
  },
  "никита": {
    full: "/assets/people/nikita-full.png",
    avatar: "/assets/people/nikita-avatar.png"
  },
  "костя": {
    full: "/assets/people/kostya-full.png",
    avatar: "/assets/people/kostya-full.png"
  },
  "алена": {
    full: "/assets/people/alyona-full.png",
    avatar: "/assets/people/alyona-avatar.png"
  },
  "алена баранова": {
    full: "/assets/people/alyona-full.png",
    avatar: "/assets/people/alyona-avatar.png"
  }
};

export function personAsset(name: string, variant: PersonAssetVariant): string | undefined {
  const asset = personAssets[normalizePersonName(name)]?.[variant];
  return asset ? appPath(asset) : undefined;
}

export function normalizePersonName(name: string): string {
  return name.trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
}

export function samePerson(left: string, right: string): boolean {
  return Boolean(left.trim() && right.trim() && normalizePersonName(left) === normalizePersonName(right));
}
import { appPath } from "./base-path.ts";
