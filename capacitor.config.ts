import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mysetlists.app',
  appName: 'MySetlists',
  webDir: 'out',

  ios: {
    scheme: 'mysetlists',
    backgroundColor: '#1f1f3a',
  },

  server: {
    // Allow navigation to these domains for OAuth and external services
    allowNavigation: [
      'accounts.spotify.com',
      'accounts.google.com',
      '*.firebaseapp.com',
      'js-cdn.music.apple.com',
      'mysetlists.net',
      '*.mysetlists.net',
    ],
  },

  plugins: {
    Keyboard: {
      resize: 'body',
      style: 'dark',
    },
    StatusBar: {
      style: 'dark',
    },
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#1f1f3a',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com', 'apple.com'],
    },
    // Push alerts (lib/pushAlerts.js). A push that arrives while the app is
    // open still shows as a banner.
    FirebaseMessaging: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
