import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface DropdownOption<T extends string | number> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}
interface Props<T extends string | number> {
  label: string;
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
  icon?: LucideIcon;
  leadingIcon?: React.ReactNode;
  disabled?: boolean;
}

/** Select-only combobox. Focus stays on the trigger while navigating the list. */
export function DropdownSelect<T extends string | number>({ label, value, options, onChange, icon: Icon, leadingIcon, disabled }: Props<T>) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.findIndex(option => option.value === value);
  const [active, setActive] = useState(Math.max(0, selected));
  const typed = useRef({ text: '', time: 0 });
  const [placement, setPlacement] = useState({ left: 0, top: 0, minWidth: 0, maxWidth: 0, maxHeight: 256 });

  const close = () => setOpen(false);
  const show = (index = Math.max(0, selected)) => {
    if (!disabled && options.length) { setActive(index); setOpen(true); }
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    close();
    trigger.current?.focus({ preventScroll: true });
    if (option.value !== value) onChange(option.value);
  };

  useLayoutEffect(() => {
    const node = menu.current;
    if (!open || !node || disabled) return;
    // The native top layer avoids clipping by scrolling toolbars and dialogs.
    const supportsPopover = typeof node.showPopover === 'function';
    if (supportsPopover && !node.matches(':popover-open')) node.showPopover();
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const padding = 8;
      const maxWidth = Math.max(0, window.innerWidth - padding * 2);
      const minWidth = Math.min(rect.width, maxWidth);
      node.style.minWidth = `${minWidth}px`;
      node.style.maxWidth = `${maxWidth}px`;
      const below = window.innerHeight - rect.bottom - padding;
      const above = rect.top - padding;
      const height = Math.min(node.scrollHeight + 2, 256);
      const upwards = below < height && above > below;
      const maxHeight = Math.max(44, Math.min(256, (upwards ? above : below) - padding));
      const width = Math.min(Math.max(node.getBoundingClientRect().width, minWidth), maxWidth);
      setPlacement({
        left: Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding)),
        top: upwards ? Math.max(padding, rect.top - Math.min(height, maxHeight) - padding) : rect.bottom + padding,
        minWidth, maxWidth, maxHeight,
      });
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!node.contains(target) && !trigger.current?.contains(target)) close();
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      document.removeEventListener('pointerdown', outside);
      if (supportsPopover && node.matches(':popover-open')) node.hidePopover();
    };
  }, [open, disabled]);

  useEffect(() => {
    if (open) menu.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const keydown = (event: React.KeyboardEvent) => {
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const last = options.length - 1;
      if (last < 0) return;
      if (!open) show(event.key === 'End' ? last : event.key === 'Home' ? 0 : Math.max(0, selected));
      else setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? last : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault(); event.stopPropagation(); choose(active);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      event.preventDefault(); event.stopPropagation();
      const now = Date.now();
      typed.current = { text: (now - typed.current.time < 600 ? typed.current.text : '') + event.key.toLocaleLowerCase(), time: now };
      const index = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(typed.current.text));
      if (index >= 0) { if (!open) show(index); else setActive(index); }
    }
  };

  return <div className="dropdown-select">
    <button ref={trigger} type="button" role="combobox" className="dropdown-trigger"
      aria-label={label + ': ' + (options[selected]?.label ?? 'Pilih opsi')} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={id} aria-activedescendant={open ? `${id}-${active}` : undefined}
      disabled={disabled || !options.length} popoverTarget={id}
      onClick={event => { event.preventDefault(); if (open) close(); else show(); }} onKeyDown={keydown}
      onBlur={event => { if (!menu.current?.contains(event.relatedTarget as Node | null)) close(); }}>
      {leadingIcon ?? (Icon && <Icon aria-hidden="true" />)}<span>{options[selected]?.label ?? 'Pilih opsi'}</span>
      <ChevronDown aria-hidden="true" className="dropdown-chevron" />
    </button>
    <div ref={menu} id={id} role="listbox" aria-label={label} popover="auto" className="dropdown-menu"
      data-open={open} style={placement} onToggle={event => { if ((event.nativeEvent as ToggleEvent).newState === 'closed') close(); }}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option"
        aria-selected={value === option.value} data-active={index === active} className="dropdown-option"
        onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        {option.icon}<span>{option.label}</span><Check aria-hidden="true" className={value === option.value ? '' : 'is-hidden'} />
      </div>)}
    </div>
  </div>;
}
