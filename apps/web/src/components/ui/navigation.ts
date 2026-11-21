import { BookOpen, Bot, Star } from 'lucide-react';
import type { ActiveTab } from '../../types';
export const APP_NAVIGATION = [
  { id: 'draft' as ActiveTab, label: 'Draft', icon: Bot },
  { id: 'wiki' as ActiveTab, label: 'Wiki', icon: BookOpen },
  { id: 'favorites' as ActiveTab, label: 'Favorit', icon: Star },
];
