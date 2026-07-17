const { join } = require('path');
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx,html}', '../../libraries/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        // Designer semantic tokens (M11/G1) — surface/selection/accent for the
        // media editor; centralizes the previously raw `#2B5CD3` accent.
        designerAccent: '#2B5CD3',
        designerSurface: '#1e1e2e',
        designerCanvas: '#1a1a2e',
        designerGuide: '#FF3B7F',
        primary: 'var(--new-bgColor)',
        secondary: 'var(--new-bgColorInner)',
        textColor: 'var(--new-btn-text)',
        third: 'var(--new-bgColorInner)',
        forth: 'var(--new-btn-primary)',
        fifth: 'var(--new-bgLineColor)',
        sixth: 'var(--new-table-header)',
        seventh: 'var(--new-btn-primary)',
        gray: 'var(--new-gray)',
        input: 'var(--new-table-header)',
        inputText: 'var(--new-input-text)',
        tableBorder: 'var(--new-table-border)',
        modalCustom: 'var(--new-modal-custom)',

        newBgColor: 'var(--new-bgColor)',
        newBackdrop: 'var(--new-back-drop)',
        newSep: 'var(--new-sep)',
        newBorder: 'var(--new-border)',
        newBgColorInner: 'var(--new-bgColorInner)',
        studioBg: 'var(--studio-bg)',
        studioBorder: 'var(--studio-border)',
        newBgLineColor: 'var(--new-bgLineColor)',
        textItemFocused: 'var(--new-textItemFocused)',
        textItemBlur: 'var(--new-textItemBlur)',
        boxFocused: 'var(--new-boxFocused)',
        newTextColor: 'rgb(var(--new-textColor) / <alpha-value>)',
        blockSeparator: 'var(--new-blockSeparator)',
        btnSimple: 'var(--new-btn-simple)',
        btnText: 'var(--new-btn-text)',
        btnPrimary: 'var(--new-btn-primary)',
        btnPrimaryAccent: 'var(--new-btn-primary-accent)',
        dangerText: 'var(--new-danger-text)',
        ai: 'var(--new-ai-btn)',
        promo: 'var(--new-promo)',
        badge: 'var(--new-badge)',
        priorityHigh: 'var(--new-priority-high)',
        priorityMedium: 'var(--new-priority-medium)',
        priorityLow: 'var(--new-priority-low)',
        boxHover: 'var(--new-box-hover)',
        newTableBorder: 'var(--new-table-border)',
        newTableHeader: 'var(--new-table-header)',
        newTableText: 'var(--new-table-text)',
        newTableTextFocused: 'var(--new-table-text-focused)',
        newColColor: 'var(--new-col-color)',
        newSettings: 'var(--new-settings)',
        menuDots: 'var(--new-menu-dots)',
        menuDotsHover: 'var(--new-menu-hover)',
        bigStrip: 'var(--new-big-strips)',
        popup: 'var(--popup-color)',
        bgLinkedin: 'var(--linkedin-bg)',
        bgFacebook: 'var(--facebook-bg)',
        bgInstagram: 'var(--instagram-bg)',
        bgTiktokItem: 'var(--tiktok-item-bg)',
        bgTiktokItemIcon: 'var(--tiktok-item-icon-bg)',
        bgYoutube: 'var(--youtube-bg)',
        bgCommentFacebook: 'var(--facebook-bg-comment)',
        textLinkedin: 'var(--linkedin-text)',
        borderPreview: 'var(--border-preview)',
        borderLinkedin: 'var(--linkedin-border)',
        youtubeButton: 'var(--youtube-button)',
        youtubeBgAction: 'var(--youtube-action-color)',
        youtubeSvg: 'var(--youtube-svg-border)',
      },
      gridTemplateColumns: {
        13: 'repeat(13, minmax(0, 1fr));',
      },
      backgroundImage: {
        loginBox: 'url(/auth/login-box.png)',
        loginBg: 'url(/auth/bg-login.png)',
      },
      fontFamily: {
        sans: ['Helvetica Neue'],
      },
      animation: {
        fade: 'fadeOut 0.5s ease-in-out',
        normalFadeIn: 'normalFadeIn 0.5s ease-in-out',
        fadeIn: 'normalFadeIn 0.2s ease-in-out forwards',
        normalFadeOut: 'normalFadeOut 0.5s linear 5s forwards',
        overflow: 'overFlow 0.5s ease-in-out forwards',
        overflowReverse: 'overFlowReverse 0.5s ease-in-out forwards',
        fadeDown: 'fadeDown 4s ease-in-out forwards',
        normalFadeDown: 'normalFadeDown 0.5s ease-in-out forwards',
        newMessages: 'newMessages 1s ease-in-out 4s forwards',
        marqueeUp: 'marquee-up 100s linear infinite',
        marqueeDown: 'marquee-down 100s linear infinite',
      },
      boxShadow: {
        yellow: '0 0 60px 20px #6b6237',
        yellowToast: '0px 0px 50px rgba(252, 186, 3, 0.3)',
        greenToast: '0px 0px 50px rgba(60, 124, 90, 0.3)',
        menu: 'var(--menu-shadow)',
        previewShadow: 'var(--preview-box-shadow)',
      },
      dropShadow: {
        glow: [
          '0 0 6px rgba(250,204,21,0.6)',
          '0 0 12px rgba(250,204,21,0.5)',
          '0 0 24px rgba(250,204,21,0.4)',
        ],
      },
      // that is actual animation
      keyframes: (theme) => ({
        fadeOut: {
          '0%': {
            opacity: 0,
            transform: 'translateY(30px)',
          },
          '100%': {
            opacity: 1,
            transform: 'translateY(0)',
          },
        },
        normalFadeOut: {
          '0%': {
            opacity: 1,
          },
          '100%': {
            opacity: 0,
          },
        },
        normalFadeIn: {
          '0%': {
            opacity: 0,
          },
          '100%': {
            opacity: 1,
          },
        },
        overFlow: {
          '0%': {
            overflow: 'hidden',
          },
          '99%': {
            overflow: 'hidden',
          },
          '100%': {
            overflow: 'visible',
          },
        },
        overFlowReverse: {
          '0%': {
            overflow: 'visible',
          },
          '99%': {
            overflow: 'visible',
          },
          '100%': {
            overflow: 'hidden',
          },
        },
        fadeDown: {
          '0%': {
            opacity: 0,
            marginTop: -30,
          },
          '10%': {
            opacity: 1,
            marginTop: 0,
          },
          '85%': {
            opacity: 1,
            marginTop: 0,
          },
          '90%': {
            opacity: 1,
            marginTop: 10,
          },
          '100%': {
            opacity: 0,
            marginTop: -30,
          },
        },
        normalFadeDown: {
          '0%': {
            opacity: 0,
            transform: 'translateY(-30px)',
          },
          '100%': {
            opacity: 1,
            transform: 'translateY(0)',
          },
        },
        newMessages: {
          '0%': {
            backgroundColor: 'var(--new-btn-primary)',
            fontWeight: 'bold',
          },
          '99%': {
            backgroundColor: 'var(--new-bgColorInner)',
            fontWeight: 'bold',
          },
          '100%': {
            backgroundColor: 'var(--new-bgColorInner)',
            fontWeight: 'normal',
          },
        },
      }),
      screens: {
        mobile: {
          raw: '(max-width: 1025px)',
        },
        tablet: {
          raw: '(max-width: 1300px)',
        },
        iconBreak: {
          raw: '(max-width: 1560px)',
        },
        maxMedia: {
          raw: '(max-width: 1400px)',
        },
        minCustom: {
          raw: '(min-height: 800px)',
        },
        custom: {
          raw: '(max-height: 800px)',
        },
        xs: {
          max: '401px',
        },
      },
    },
  },
  plugins: [
    require('tailwind-scrollbar'),
    require('tailwindcss-rtl'),
    function ({ addVariant }) {
      addVariant('child', '& > *');
      addVariant('child-hover', '& > *:hover');
    },
  ],
};
