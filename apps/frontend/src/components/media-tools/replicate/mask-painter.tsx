'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface MaskPainterProps {
  sourceImage: string;
  onMaskReady: (maskFile: File) => void;
}

export function MaskPainter({ sourceImage, onMaskReady }: MaskPainterProps) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const [isEraser, setIsEraser] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    if (!sourceImage || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      // Initialize the mask canvas to black (unmasked)
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = img.width;
      maskCanvas.height = img.height;
      const maskCtx = maskCanvas.getContext('2d');
      if (maskCtx) {
        maskCtx.fillStyle = 'black';
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      }
      maskCanvasRef.current = maskCanvas;

      setImageLoaded(true);
    };
    img.src = sourceImage;
  }, [sourceImage]);

  const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const maskCanvas = maskCanvasRef.current;
    const maskCtx = maskCanvas?.getContext('2d');
    if (!canvas || !ctx || !maskCanvas || !maskCtx) return;

    const pos = getPos(e);

    // Display canvas: translucent white stroke over the source image
    ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
    ctx.fillStyle = isEraser ? 'rgba(0,0,0,0)' : 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, brushSize, 0, Math.PI * 2);
    ctx.fill();

    // Mask canvas: pure white where painted, black where erased
    maskCtx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
    maskCtx.fillStyle = 'white';
    maskCtx.beginPath();
    maskCtx.arc(pos.x, pos.y, brushSize, 0, Math.PI * 2);
    maskCtx.fill();
  }, [isDrawing, isEraser, brushSize, getPos]);

  const exportMask = useCallback(async () => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;

    maskCanvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'mask.png', { type: 'image/png' });
        onMaskReady(file);
      }
    }, 'image/png');
  }, [onMaskReady]);

  const clearMask = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    const maskCtx = maskCanvas?.getContext('2d');
    if (!maskCanvas || !maskCtx) return;
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
    };
    img.src = sourceImage;
  }, [sourceImage]);

  return (
    <div className="flex flex-col gap-3 w-full items-center">
      <div className="relative border border-studioBorder rounded-xl overflow-hidden bg-gray-900 shadow-2xl">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-[calc(100vh-280px)] object-contain cursor-crosshair"
          onMouseDown={() => setIsDrawing(true)}
          onMouseUp={() => setIsDrawing(false)}
          onMouseLeave={() => setIsDrawing(false)}
          onMouseMove={draw}
          onTouchStart={() => setIsDrawing(true)}
          onTouchEnd={() => setIsDrawing(false)}
          onTouchMove={draw}
        />
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
            <p className="text-sm text-gray-500">{t('select_source_image_first', 'Select a source image first')}</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEraser(false)}
            className={`px-3 py-1 rounded-lg text-xs ${!isEraser ? 'bg-designerAccent text-white' : 'bg-btnSimple text-newTextColor/70'}`}
          >
            {t('brush', 'Brush')}
          </button>
          <button
            onClick={() => setIsEraser(true)}
            className={`px-3 py-1 rounded-lg text-xs ${isEraser ? 'bg-designerAccent text-white' : 'bg-btnSimple text-newTextColor/70'}`}
          >
            {t('eraser', 'Eraser')}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="mask-brush-size" className="text-xs text-newTextColor/70">{t('size_colon', 'Size:')}</label>
          <input
            id="mask-brush-size"
            type="range"
            min="5"
            max="100"
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-24 accent-designerAccent"
          />
          <span className="text-xs text-newTextColor/65">{brushSize}px</span>
        </div>
        <button
          onClick={clearMask}
          className="px-3 py-1.5 rounded-lg bg-btnSimple text-newTextColor/70 text-xs hover:bg-boxHover transition-colors"
        >
          {t('clear', 'Clear')}
        </button>
        <button
          onClick={exportMask}
          className="ml-auto px-4 py-1.5 rounded-lg bg-designerAccent text-white text-xs hover:bg-designerAccent/80"
        >
          {t('use_mask', 'Use Mask')}
        </button>
      </div>
    </div>
  );
}
