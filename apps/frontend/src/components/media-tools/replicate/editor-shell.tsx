'use client';

import React from 'react';

// Shared framed editor layout for the in-studio canvas tools (meme / merge / mask):
// a toolbar header, a dark full-bleed "stage" that centres the canvas, and an
// optional right inspector — the Designer's frame, scoped to one tool.
export function EditorShell({
  title,
  toolbar,
  inspector,
  stageClassName = '',
  children,
}: {
  title: string;
  toolbar?: React.ReactNode;
  inspector?: React.ReactNode;
  stageClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between h-12 flex-shrink-0 px-4 border-b border-studioBorder">
        <h2 className="text-sm font-medium text-textColor">{title}</h2>
        {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
      </div>
      <div className="flex mobile:flex-col flex-1 overflow-hidden">
        <div
          className={`flex-1 flex items-center justify-center overflow-auto bg-[#0d0d12] p-6 mobile:p-3 ${stageClassName}`}
        >
          {children}
        </div>
        {inspector && (
          <div className="w-72 flex-shrink-0 border-l border-studioBorder overflow-y-auto bg-newBgColorInner mobile:w-full mobile:border-l-0 mobile:border-t mobile:max-h-[45%]">
            {inspector}
          </div>
        )}
      </div>
    </div>
  );
}

export const toolbarBtn =
  'px-3 py-1.5 rounded-lg bg-btnSimple text-textColor text-xs hover:bg-boxHover transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
export const toolbarPrimary =
  'px-3 py-1.5 rounded-lg bg-designerAccent text-white text-xs font-medium hover:bg-designerAccent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
