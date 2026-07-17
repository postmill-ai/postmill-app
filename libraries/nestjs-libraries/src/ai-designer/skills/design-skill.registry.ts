import type { DesignSkill } from './design-skill.interface';
import { MemeSkill } from './skills/meme.skill';
import { AdvertisementSkill } from './skills/advertisement.skill';
import { GreetingCardSkill } from './skills/greeting-card.skill';
import { ProductPromoSkill } from './skills/product-promo.skill';
import { AnnouncementSkill } from './skills/announcement.skill';

export const DESIGN_SKILLS: DesignSkill[] = [
  MemeSkill,
  AdvertisementSkill,
  GreetingCardSkill,
  ProductPromoSkill,
  AnnouncementSkill,
];

export const getDesignSkill = (id: string): DesignSkill | undefined =>
  DESIGN_SKILLS.find((s) => s.id === id);
