import localFont from 'next/font/local';

export const jakartaSans = localFont({
  src: [
    {
      path: '../../../public/fonts/PlusJakartaSans-VariableFont_wght.ttf',
      style: 'normal',
    },
    {
      path: '../../../public/fonts/PlusJakartaSans-Italic-VariableFont_wght.ttf',
      style: 'italic',
    },
  ],
  display: 'swap',
});
