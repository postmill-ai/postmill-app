export const CONTEXT_MENU_VIEWPORT_MARGIN = 8;

interface Viewport {
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

export interface MenuPlacement {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  opensLeft: boolean;
  opensUp: boolean;
  scrollable: boolean;
}

interface TriggerRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, Math.max(min, max)));

export function getContextMenuPlacement(
  point: Point,
  menu: Size,
  viewport: Viewport,
  margin = CONTEXT_MENU_VIEWPORT_MARGIN
): MenuPlacement {
  const rightSpace = Math.max(0, viewport.width - margin - point.x);
  const leftSpace = Math.max(0, point.x - margin);
  const belowSpace = Math.max(0, viewport.height - margin - point.y);
  const aboveSpace = Math.max(0, point.y - margin);
  const opensLeft = menu.width > rightSpace && leftSpace > rightSpace;
  const opensUp = menu.height > belowSpace && aboveSpace > belowSpace;
  const maxWidth = Math.min(
    menu.width,
    Math.max(0, viewport.width - margin * 2),
    opensLeft ? leftSpace : rightSpace
  );
  const maxHeight = Math.min(
    menu.height,
    Math.max(0, viewport.height - margin * 2),
    opensUp ? aboveSpace : belowSpace
  );
  const renderedWidth = Math.min(menu.width, maxWidth);
  const renderedHeight = Math.min(menu.height, maxHeight);

  return {
    left: clamp(
      opensLeft ? point.x - renderedWidth : point.x,
      margin,
      viewport.width - margin - renderedWidth
    ),
    top: clamp(
      opensUp ? point.y - renderedHeight : point.y,
      margin,
      viewport.height - margin - renderedHeight
    ),
    maxWidth,
    maxHeight,
    opensLeft,
    opensUp,
    scrollable: menu.height > maxHeight,
  };
}

export function getSubmenuPlacement(
  trigger: TriggerRect,
  submenu: Size,
  viewport: Viewport,
  margin = CONTEXT_MENU_VIEWPORT_MARGIN
): MenuPlacement {
  const rightSpace = Math.max(0, viewport.width - margin - trigger.right);
  const leftSpace = Math.max(0, trigger.left - margin);
  const preferredTop = trigger.top - 4;
  const upwardBottom = trigger.bottom + 4;
  const belowSpace = Math.max(0, viewport.height - margin - preferredTop);
  const aboveSpace = Math.max(0, upwardBottom - margin);
  const opensLeft = submenu.width > rightSpace && leftSpace > rightSpace;
  const opensUp = submenu.height > belowSpace && aboveSpace > belowSpace;
  const maxWidth = Math.min(
    submenu.width,
    Math.max(0, viewport.width - margin * 2),
    opensLeft ? leftSpace : rightSpace
  );
  const maxHeight = Math.min(
    submenu.height,
    Math.max(0, viewport.height - margin * 2),
    opensUp ? aboveSpace : belowSpace
  );
  const renderedWidth = Math.min(submenu.width, maxWidth);
  const renderedHeight = Math.min(submenu.height, maxHeight);

  return {
    left: clamp(
      opensLeft ? trigger.left - renderedWidth : trigger.right,
      margin,
      viewport.width - margin - renderedWidth
    ),
    top: clamp(
      opensUp ? upwardBottom - renderedHeight : preferredTop,
      margin,
      viewport.height - margin - renderedHeight
    ),
    maxWidth,
    maxHeight,
    opensLeft,
    opensUp,
    scrollable: submenu.height > maxHeight,
  };
}
