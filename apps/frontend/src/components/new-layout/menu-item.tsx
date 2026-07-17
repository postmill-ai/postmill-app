'use client';
import { FC, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import Link from 'next/link';

export const MenuItem: FC<{ label: string; icon: ReactNode; path: string; onClick?: () => void; badge?: number }> = ({
  label,
  icon,
  path,
  onClick,
  badge,
}) => {
  const currentPath = usePathname();
  const isActive = currentPath.indexOf(path) === 0;

  const className = clsx(
    'group relative w-full minCustom:h-[54px] custom:h-[44px] py-[8px] px-[6px] minCustom:gap-[4px] custom:gap-[2px] flex flex-col font-[600] items-center justify-center rounded-[12px] hover:text-textItemFocused hover:bg-boxFocused transition-colors',
    isActive
      ? 'text-textItemFocused bg-boxFocused before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[4px] before:h-[20px] before:bg-btnPrimary before:rounded-r-[4px]'
      : 'text-textItemBlur'
  );

  const inner = (
    <>
      <div className="w-[20px] h-[20px] flex items-center justify-center custom:scale-90 transition-transform">{icon}</div>
      <div className="custom:text-[9px] minCustom:text-[10px] leading-[1.1] text-center">
        {label}
      </div>
      {badge !== undefined && badge > 0 && (
        <div className="absolute top-[4px] right-[4px] min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-btnPrimary text-[9px] font-[600] text-white px-[4px]">
          {badge > 99 ? '99+' : badge}
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button onClick={onClick} title={label} className={className}>
        {inner}
      </button>
    );
  }

  return (
    <Link
      prefetch={true}
      href={path}
      title={label}
      {...path.indexOf('http') === 0 && { target: '_blank' }}
      className={className}
    >
      {inner}
    </Link>
  );
};
