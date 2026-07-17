'use client';

import {
  ButtonHTMLAttributes,
  DetailedHTMLProps,
  FC,
  useCallback,
  useState,
} from 'react';
import { clsx } from 'clsx';
const ReactLoading = ({ width = 20, height = 20 }: { type?: string; color?: string; width?: number; height?: number }) => {
  const size = Math.min(width, height);
  const borderWidth = Math.max(2, Math.round(size / 8));
  return (
    <div
      style={{
        width: size,
        height: size,
        border: `${borderWidth}px solid transparent`,
        borderTopColor: 'currentColor',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }}
    />
  );
};
  export const Button: FC<
    DetailedHTMLProps<
      ButtonHTMLAttributes<HTMLButtonElement>,
      HTMLButtonElement
    > & {
      secondary?: boolean;
      danger?: boolean;
      loading?: boolean;
      innerClassName?: string;
    }
  > = ({ children, loading, innerClassName, secondary, danger, ...props }) => {
  const [height, setHeight] = useState<number | null>(null);
  const buttonRef = useCallback((node: HTMLButtonElement | null) => {
    if (node) {
      setHeight(node.offsetHeight);
    }
  }, []);
  return (
    <button
      {...props}
      type={props.type || 'button'}
      ref={buttonRef}
      className={clsx(
        (props.disabled || loading) && 'opacity-50 pointer-events-none',
        `${
          danger ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 active:scale-[0.98]'
          : secondary ? 'bg-btnSimple text-btnText border border-newTableBorder hover:bg-boxHover'
          : 'bg-btnPrimary text-white hover:bg-btnPrimary/90 active:scale-[0.98]'
        } px-[20px] h-[40px] text-[14px] font-[500] rounded-[8px] cursor-pointer items-center justify-center flex relative transition-all duration-150 focus-visible:ring-2 ring-btnPrimary/40 outline-none`,
        props?.className
      )}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <ReactLoading
            width={height! / 2}
            height={height! / 2}
          />
        </div>
      )}
      <div
        className={clsx(
          innerClassName,
          'flex-1 items-center justify-center flex',
          loading && 'invisible'
        )}
      >
        {children}
      </div>
    </button>
  );
};
