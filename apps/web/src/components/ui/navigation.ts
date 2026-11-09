import { BookOpen, Bot, Star, Swords } from 'lucide-react';
import type { ActiveTab } from '../../types';
export const APP_NAVIGATION = [
  { id: 'draft' as ActiveTab, label: 'Draft', icon: Bot },
  { id: 'counter' as ActiveTab, label: 'Counter', icon: Swords },
  { id: 'wiki' as ActiveTab, label: 'Wiki & tier', icon: BookOpen },
  { id: 'favorites' as ActiveTab, label: 'Favorit', icon: Star },
];
