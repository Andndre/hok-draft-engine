import React, { useState } from 'react';
import { Package, UserRound } from 'lucide-react';
import type { Hero } from '../../types';

interface Props {
  src?: string;
  name: string;
  fallbackSrc?: string;
  kind?: 'hero' | 'item';
  className?: string;
}
function ImageWithFallback({ src, name, fallbackSrc, kind = 'hero', className = '' }: Props) {
  const [attempt, setAttempt] = useState(0);
  const sources = [...new Set([src, fallbackSrc].filter((value): value is string => !!value))];
  const Icon = kind === 'item' ? Package : UserRound;
  return <span className={'asset-thumbnail ' + className}>
    {sources[attempt] ? <img src={sources[attempt]} alt={name} loading="lazy" decoding="async" onError={() => setAttempt(value => value + 1)} /> : <Icon aria-label={name} role="img" strokeWidth={1.6} />}
  </span>;
}
export function AssetThumbnail(props: Props) {
  return <ImageWithFallback key={(props.src ?? '') + (props.fallbackSrc ?? '')} {...props} />;
}
export function HeroThumbnail({ hero, className = '' }: { hero: Hero; className?: string }) {
  return <AssetThumbnail src={hero.portrait_asset} fallbackSrc={'https://hok.kurohiko.id/icons/hero/' + hero.hero_id + '.webp'} name={hero.name} className={className} />;
}
