import React from 'react';
import type { Role } from '../../types';

// Source: https://www.hokfire.com/assets/img/roles/{role}.png.
// Local lossless WebP copies preserve the original 38x38 pixels and transparency.
export function RoleIcon({ role }: { role: Role }) {
  return <img className="role-icon" src={`/assets/roles/${role.toLowerCase()}.webp`}
    width={38} height={38} alt="" aria-hidden="true" decoding="async" draggable={false} />;
}

export function RoleLabel({ role }: { role: Role }) {
  return <span className="role-label"><RoleIcon role={role} /><span>{role}</span></span>;
}
