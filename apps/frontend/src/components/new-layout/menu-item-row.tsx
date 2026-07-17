'use client';

import { FC, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import Link from 'next/link';

// Full-width row variant of MenuItem (icon + label, left-aligned), used by the
// mobile "More" sheet and other mobile menu surfaces.
export const MenuItemRow: FC<{
  label: string;
  icon: ReactNode;
  path?: string;
  onClick?: () => void;
}> = ({ label, icon, path, onClick }) => {
  const currentPath = usePathname();
  const isActive = !!path && path !== '#' && currentPath.indexOf(path) === 0;

  const className = clsx(
    'flex items-center gap-[14px] w-full px-[16px] py-[12px] rounded-[10px] text-[15px] font-[600] transition-colors text-start',
    isActive
      ? 'bg-boxFocused text-textItemFocused'
      : 'text-textItemBlur hover:bg-boxHover hover:text-newTextColor'
  );

  const inner = (
    <>
      <span className="w-[22px] h-[22px] flex items-center justify-center shrink-0">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {inner}
      </button>
    );
  }

  if (!path || path === '#') {
    return <div className={className}>{inner}</div>;
  }

  return (
    <Link
      href={path}
      {...(path.indexOf('http') === 0 && { target: '_blank' })}
      className={className}
    >
      {inner}
    </Link>
  );
};
