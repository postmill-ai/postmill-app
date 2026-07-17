'use client';

import React, {
  useCallback,
  useEffect,
  useState,
  useRef,
  FC,
  ReactNode,
} from 'react';
import { useNeynarContext } from '@neynar/react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
export const NeynarAuthButton: FC<{
  children: ReactNode;
  onLogin: (code: string) => void;
}> = (props) => {
  const { children, onLogin } = props;
  const t = useT();
  const { client_id } = useNeynarContext();
  const [showModal, setShowModal] = useState(false);
  const authWindowRef = useRef<Window | null>(null);
  const neynarLoginUrl = `${
    process.env.NEYNAR_LOGIN_URL ?? 'https://app.neynar.com/login'
  }?client_id=${client_id}`;
  const authOrigin = new URL(neynarLoginUrl).origin;
  const modalRef = useRef<HTMLDivElement>(null);

  // Ref listener pattern: the stable wrapper is added/removed once, while the
  // actual handler is kept in a ref so it can read the latest props/refs.
  const handleMessageRef = useRef<((event: MessageEvent) => void) | undefined>(undefined);
  const handleMessage = useCallback((event: MessageEvent) => {
    handleMessageRef.current?.(event);
  }, []);
  useEffect(() => {
    handleMessageRef.current = (event) => {
      if (
        event.origin === authOrigin &&
        event.data &&
        event.data.is_authenticated
      ) {
        authWindowRef.current?.close();
        window.removeEventListener('message', handleMessage);
        delete event.data.user.profile;
        const _user = {
          signer_uuid: event.data.signer_uuid,
          ...event.data.user,
        };
        onLogin(Buffer.from(JSON.stringify(_user)).toString('base64'));
      }
    };
  });

  const handleSignIn = useCallback(() => {
    const width = 600,
      height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    const windowFeatures = `width=${width},height=${height},top=${top},left=${left}`;
    authWindowRef.current = window.open(
      neynarLoginUrl,
      '_blank',
      windowFeatures
    );
    if (!authWindowRef.current) {
      console.error(
        t(
          'popup_blocker_warning',
          'Failed to open the authentication window. Please check your pop-up blocker settings.'
        )
      );
      return;
    }
    window.addEventListener('message', handleMessage, false);
  }, [neynarLoginUrl, handleMessage]);
  const closeModal = () => setShowModal(false);
  useEffect(() => {
    return () => {
      window.removeEventListener('message', handleMessage); // Cleanup function to remove listener
    };
  }, [handleMessage]);
  const handleOutsideClick = useCallback((event: any) => {
    if (modalRef.current && !modalRef.current.contains(event.target)) {
      closeModal();
    }
  }, []);
  useEffect(() => {
    if (showModal) {
      document.addEventListener('mousedown', handleOutsideClick);
    } else {
      document.removeEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [showModal, handleOutsideClick]);
  return <div onClick={handleSignIn} className="flex-1">{children}</div>;
};
