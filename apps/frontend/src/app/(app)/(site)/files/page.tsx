import { FileManager } from '@gitroom/frontend/components/files/file-manager';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: `Postmill Files`,
  description: '',
};

export default async function Page() {
  return (
    <div className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[15px] transition-all min-h-0">
      <FileManager standalone />
    </div>
  );
}
