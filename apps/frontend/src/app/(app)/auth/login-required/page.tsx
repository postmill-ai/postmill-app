import { getT } from '@gitroom/react/translation/get.translation.service.backend';

export default async function LoginRequiredPage() {
  const t = await getT();
  return (
    <div className="fixed left-0 top-0 w-full h-full bg-[#121212] z-[100] flex justify-center items-center text-4xl">
      {t(
        'login_to_use_the_wizard_to_generate_api_code',
        'Login to use the wizard to generate API code'
      )}
    </div>
  );
}
