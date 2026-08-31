'use client';

import { useEffect, useRef, useState } from 'react';

export function useCountUp(target: number, duration = 800, enabled = true) {
  const prefersReducedMotion =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  const isAnimated = enabled && !prefersReducedMotion;
  const [value, setValue] = useState(isAnimated ? 0 : target);
  const startTime = useRef<number>(0);
  const raf = useRef<number>(0);
  const displayedRef = useRef(value);

  useEffect(() => {
    if (!isAnimated) {
      return;
    }

    const startFrom = displayedRef.current;
    startTime.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startFrom + (target - startFrom) * eased;
      displayedRef.current = current;
      setValue(current);

      if (progress < 1) {
        raf.current = requestAnimationFrame(animate);
      } else {
        displayedRef.current = target;
        setValue(target);
      }
    };

    raf.current = requestAnimationFrame(animate);

    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, duration, isAnimated]);

  // When animation is disabled (or reduced motion is preferred) the target is
  // returned directly, avoiding a synchronous setState in the effect.
  return isAnimated ? value : target;
}
