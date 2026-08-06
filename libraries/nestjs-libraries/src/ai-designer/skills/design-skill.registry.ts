import type { DesignSkill } from './design-skill.interface';
import { MemeSkill } from './skills/meme.skill';
import { AdvertisementSkill } from './skills/advertisement.skill';
import { GreetingCardSkill } from './skills/greeting-card.skill';
import { ProductPromoSkill } from './skills/product-promo.skill';
import { ReferenceCloneSkill } from './skills/reference-clone.skill';
import { AnnouncementSkill } from './skills/announcement.skill';
import { COMMERCE_SKILLS } from './skills/commerce.skills';
import { ANNOUNCEMENT_SKILLS } from './skills/announcement.skills';
import { SOCIAL_NATIVE_SKILLS } from './skills/social-native.skills';
import { AUTHORITY_SKILLS } from './skills/authority.skills';
import { SOCIAL_PROOF_SKILLS } from './skills/social-proof.skills';
import { SEASONAL_SKILLS } from './skills/seasonal.skills';
import { VERTICAL_SKILLS } from './skills/vertical.skills';

/**
 * The design genres the router can pick from.
 *
 * ORDER breaks only EXACT ties: the router sorts by score with a stable sort,
 * so an earlier entry wins solely at equal confidence. It does NOT make the
 * originals win overlaps — `defineSkill` genres score 0.95 on a signal match
 * while four of the five originals score 0.9, so when a brief matches both a
 * general original and a specific new genre ("announcing our launch" hits
 * `announcement` AND `product-launch`), the specific genre wins BY SCORE.
 * That is intended: the specific genre's art direction is the better answer.
 * Where order still decides: two `defineSkill` genres tying at 0.95 (earlier
 * family wins), and two 0.9 originals tying (earlier original wins).
 *
 * Newer genres are grouped by family rather than one file per genre. Forty
 * single-skill files would be forty near-identical imports and forty registry
 * lines; a family reads as a set, which is how they are actually written and
 * revised against each other.
 */
export const DESIGN_SKILLS: DesignSkill[] = [
  MemeSkill,
  AdvertisementSkill,
  GreetingCardSkill,
  ProductPromoSkill,
  AnnouncementSkill,
  // Meta-skill: outranks every genre (match 0.98) the moment the brief
  // carries reference cues — a user who attached a design wants ITS
  // structure, not a genre's conventions.
  ReferenceCloneSkill,
  ...COMMERCE_SKILLS,
  ...ANNOUNCEMENT_SKILLS,
  ...SOCIAL_NATIVE_SKILLS,
  ...AUTHORITY_SKILLS,
  ...SOCIAL_PROOF_SKILLS,
  ...SEASONAL_SKILLS,
  ...VERTICAL_SKILLS,
];

export const getDesignSkill = (id: string): DesignSkill | undefined =>
  DESIGN_SKILLS.find((s) => s.id === id);
