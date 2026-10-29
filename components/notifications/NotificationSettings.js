'use client';
import { useState, useEffect } from 'react';
import { Bell, BellOff, BellRing, Check, AlertCircle } from 'lucide-react';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db, requestNotificationPermission } from '@/lib/firebase';
import { isNativePlatform } from '@/lib/native-auth';
import { alertChannels, withChannel } from '@/lib/alertChannels';
import { pushPermission, requestPushPermission } from '@/lib/pushAlerts';
import { openAppSettings } from '@/lib/nativePermissions';
import Button from '@/components/ui/Button';

// The followed-band job's two alerts (netlify/functions/lib/followedBandAlerts.js
// reads these prefs). Every alert is also in Notifications in the app; these
// choose whether it is pushed and emailed too, each on its own
// (lib/alertChannels.js). Push needs permission on this device first: on
// iOS from PushAlertsCard below (or the first follow), on the web from
// "Enable Notifications".
const ALERT_PREFS = [
  {
    key: 'followedBands',
    title: 'Bands you follow',
    description: 'Tell me when a band I follow announces a new tour (three or more new dates)',
  },
  {
    key: 'venueBucketList',
    title: 'Venue bucket list matches',
    description: 'Tell me when a band I follow is playing at a venue on my bucket list',
  },
];

function ChannelToggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-primary min-h-touch md:min-h-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-active bg-hover text-brand focus:ring-brand/50 focus:ring-offset-0 cursor-pointer"
      />
      {label}
    </label>
  );
}

function AlertPrefs({ preferences, onChange, pushReady }) {
  return ALERT_PREFS.map(({ key, title, description }) => {
    const pref = preferences[key] || {};
    const enabled = pref.enabled !== false;
    const channels = alertChannels(pref);
    return (
      <div key={key} className="mt-5 pt-5 border-t border-subtle">
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange(key, { ...pref, enabled: e.target.checked })}
            className="mt-1 w-4 h-4 rounded border-active bg-hover text-brand focus:ring-brand/50 focus:ring-offset-0 cursor-pointer"
          />
          <div>
            <span className="text-primary text-sm font-medium group-hover:text-brand transition-colors">{title}</span>
            <p className="text-secondary text-xs">{description}</p>
          </div>
        </label>

        {enabled && (
          <div className="mt-2 pl-7 flex flex-wrap gap-x-6">
            {pushReady && (
              <ChannelToggle label="Push" checked={channels.push} onChange={(on) => onChange(key, withChannel(pref, 'push', on))} />
            )}
            <ChannelToggle label="Email" checked={channels.email} onChange={(on) => onChange(key, withChannel(pref, 'email', on))} />
          </div>
        )}
      </div>
    );
  });
}

/**
 * Push alerts on this iPhone: the button that asks for permission, or what
 * to do when iOS has it switched off. Asking happens here or on the first
 * follow, never at launch.
 */
function PushAlertsCard({ userId, state, onState }) {
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);

  if (!state || state === 'unsupported') return null;

  const turnOn = async () => {
    setBusy(true);
    const next = await requestPushPermission(userId);
    setBusy(false);
    setDeclined(next !== 'granted');
    onState(next);
  };

  return (
    <div className="mt-5 pt-5 border-t border-subtle">
      <div className="flex items-start gap-3">
        <BellRing className="w-5 h-5 text-brand flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-primary text-sm font-medium">Push alerts</p>
          {state === 'granted' && (
            <p className="text-secondary text-xs mt-1 flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-brand" /> On for this iPhone. Choose which alerts below.
            </p>
          )}
          {state === 'prompt' && (
            <>
              <p className="text-secondary text-xs mt-1">
                Get a push when a band you follow announces a tour or plays a venue on your bucket list. Nothing else.
              </p>
              <div className="mt-3">
                <Button size="sm" icon={Bell} onClick={turnOn} loading={busy}>Turn on push alerts</Button>
              </div>
            </>
          )}
          {state === 'denied' && (
            <>
              <p className="text-secondary text-xs mt-1">
                {declined ? 'No problem. ' : ''}Push is off for MySetlists in iOS Settings. Email alerts still work.
              </p>
              <button
                type="button"
                onClick={openAppSettings}
                className="mt-2 text-brand text-xs font-semibold hover:underline"
              >
                Open Settings
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NotificationSettings({ userId }) {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [loading, setLoading] = useState(false);
  const [fcmToken, setFcmToken] = useState(null);
  // iOS push permission: null until checked, then lib/pushAlerts.js's state.
  const [pushState, setPushState] = useState(null);
  const [preferences, setPreferences] = useState({
    showReminders: true,
    newFeatures: true,
    communityUpdates: false,
    engagementNotifications: true,
    emailFrequency: 'off', // 'off' | 'immediate' — daily/weekly digest needs a scheduled job that doesn't exist yet
    anniversaries: { enabled: true, method: 'both' }, // method: 'push' | 'email' | 'both'
    venueBucketList: { enabled: true, method: 'both' }, // method: 'push' | 'email' | 'both'
    followedBands: { enabled: true, method: 'both' }, // method: 'push' | 'email' | 'both'
  });

  useEffect(() => {
    // Load user notification preferences
    const loadPreferences = async () => {
      if (!userId) return;
      try {
        const profileRef = doc(db, 'userProfiles', userId);
        const profile = await getDoc(profileRef);
        if (profile.exists()) {
          if (profile.data().notificationPrefs) {
            setPreferences(prev => ({
              ...prev,
              ...profile.data().notificationPrefs,
              anniversaries: { ...prev.anniversaries, ...profile.data().notificationPrefs.anniversaries },
              venueBucketList: { ...prev.venueBucketList, ...profile.data().notificationPrefs.venueBucketList },
              followedBands: { ...prev.followedBands, ...profile.data().notificationPrefs.followedBands },
            }));
          }
          if (profile.data().fcmToken) {
            setFcmToken(profile.data().fcmToken);
          }
        }
      } catch (error) {
        console.error('Failed to load notification preferences:', error);
      }
    };
    loadPreferences();
  }, [userId]);

  // Checked on open and again on returning from iOS Settings.
  useEffect(() => {
    if (!isNativePlatform()) return undefined;
    let live = true;
    let handle = null;
    const check = () => pushPermission().then((s) => { if (live) setPushState(s); });
    check();
    import('@capacitor/app')
      .then(({ App }) => App.addListener('appStateChange', ({ isActive }) => { if (isActive) check(); }))
      .then((h) => { if (live) handle = h; else h.remove(); })
      .catch(() => {});
    return () => { live = false; handle?.remove(); };
  }, []);

  const handleEnableNotifications = async () => {
    setLoading(true);
    try {
      const token = await requestNotificationPermission();
      if (token) {
        setFcmToken(token);
        setPermission('granted');

        // Save token to user profile
        if (userId) {
          const profileRef = doc(db, 'userProfiles', userId);
          await updateDoc(profileRef, { fcmToken: token });
        }
      } else {
        // Permission was denied or failed
        setPermission(Notification.permission);
      }
    } catch (error) {
      console.error('Failed to enable notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePreferenceChange = async (key, value) => {
    const newPrefs = { ...preferences, [key]: value };
    setPreferences(newPrefs);

    // Save to Firestore
    if (userId) {
      try {
        const profileRef = doc(db, 'userProfiles', userId);
        await updateDoc(profileRef, { notificationPrefs: newPrefs });
      } catch (error) {
        console.error('Failed to save notification preferences:', error);
      }
    }
  };

  // Check if notifications are supported (web-push only)
  const notificationsSupported = typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
  const isNative = isNativePlatform();

  // On native, skip the web-push section and show only in-app notifications
  if (isNative) {
    return (
      <div className="bg-hover border border-subtle rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
          <Bell className="w-5 h-5 text-brand" />
          Notifications
        </h3>

        {/* Replies & likes */}
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={preferences.engagementNotifications}
            onChange={(e) => handlePreferenceChange('engagementNotifications', e.target.checked)}
            className="mt-1 w-4 h-4 rounded border-active bg-hover text-brand focus:ring-brand/50 focus:ring-offset-0 cursor-pointer"
          />
          <div>
            <span className="text-primary text-sm font-medium group-hover:text-brand transition-colors">
              Replies & likes
            </span>
            <p className="text-secondary text-xs">Notify me when someone replies to my comment, or likes my comment or photo</p>
          </div>
        </label>

        {preferences.engagementNotifications && (
          <div className="mt-3 pl-7">
            <label className="text-secondary text-xs font-medium block mb-1.5">Also email me</label>
            <select
              value={preferences.emailFrequency || 'off'}
              onChange={(e) => handlePreferenceChange('emailFrequency', e.target.value)}
              className="text-sm bg-hover border border-active rounded-lg px-2.5 py-1.5 text-primary focus:ring-2 focus:ring-brand/50 focus:outline-none"
            >
              <option value="off">Off</option>
              <option value="immediate">Immediately</option>
            </select>
            <p className="text-muted text-xs mt-1">Daily and weekly digest options are coming later.</p>
          </div>
        )}

        {/* Anniversary reminders */}
        <div className="mt-5 pt-5 border-t border-subtle">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={preferences.anniversaries?.enabled !== false}
              onChange={(e) => handlePreferenceChange('anniversaries', { ...preferences.anniversaries, enabled: e.target.checked })}
              className="mt-1 w-4 h-4 rounded border-active bg-hover text-brand focus:ring-brand/50 focus:ring-offset-0 cursor-pointer"
            />
            <div>
              <span className="text-primary text-sm font-medium group-hover:text-brand transition-colors">
                Anniversary reminders
              </span>
              <p className="text-secondary text-xs">"X years ago today you saw..." — on the exact date, once a year per show</p>
            </div>
          </label>

          {preferences.anniversaries?.enabled !== false && (
            <div className="mt-3 pl-7">
              <label className="text-secondary text-xs font-medium block mb-1.5">Notify me via</label>
              <select
                value={preferences.anniversaries?.method || 'both'}
                onChange={(e) => handlePreferenceChange('anniversaries', { ...preferences.anniversaries, method: e.target.value })}
                className="text-sm bg-hover border border-active rounded-lg px-2.5 py-1.5 text-primary focus:ring-2 focus:ring-brand/50 focus:outline-none"
              >
                <option value="both">Push and email</option>
                <option value="push">Push only</option>
                <option value="email">Email only</option>
              </select>
            </div>
          )}
        </div>

        <PushAlertsCard userId={userId} state={pushState} onState={setPushState} />
        <AlertPrefs preferences={preferences} onChange={handlePreferenceChange} pushReady={pushState === 'granted'} />
      </div>
    );
  }

  // Web version: show web-push section if supported, otherwise show unsupported message
  if (!notificationsSupported) {
    return (
      <div className="bg-hover border border-subtle rounded-2xl p-6">
        <div className="flex items-center gap-3 text-secondary">
          <BellOff className="w-5 h-5" />
          <span>Notifications are not supported in this browser</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-hover border border-subtle rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
        <Bell className="w-5 h-5 text-brand" />
        Notifications
      </h3>

      {permission !== 'granted' ? (
        <div className="space-y-4">
          <p className="text-secondary text-sm">
            Enable notifications to get reminders to rate your shows and stay updated on new features.
          </p>

          {permission === 'denied' ? (
            <div className="flex items-start gap-3 p-4 bg-brand-subtle border border-brand/20 rounded-xl">
              <AlertCircle className="w-5 h-5 text-brand flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-brand font-medium text-sm">Notifications are blocked</p>
                <p className="text-secondary text-xs mt-1">
                  To enable notifications, click the lock icon in your browser's address bar and allow notifications for this site.
                </p>
              </div>
            </div>
          ) : (
            <button
              onClick={handleEnableNotifications}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2.5 bg-brand hover:bg-brand disabled:opacity-50 text-primary rounded-xl font-medium transition-colors"
            >
              <Bell className="w-4 h-4" />
              {loading ? 'Enabling...' : 'Enable Notifications'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-brand text-sm">
            <Check className="w-4 h-4" />
            Notifications enabled
          </div>

          <div className="space-y-3">
            {[
              { key: 'showReminders', label: 'Show rating reminders', desc: 'Remind me to rate shows I attended' },
              { key: 'newFeatures', label: 'New features', desc: 'Get notified about new app features' },
              { key: 'communityUpdates', label: 'Community updates', desc: 'Updates from the concert community' }
            ].map(({ key, label, desc }) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={preferences[key]}
                  onChange={(e) => handlePreferenceChange(key, e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-active bg-hover text-brand focus:ring-brand/50 focus:ring-offset-0 cursor-pointer"
                />
                <div>
                  <span className="text-primary text-sm font-medium group-hover:text-brand transition-colors">
                    {label}
                  </span>
                  <p className="text-secondary text-xs">{desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* In-app notifications (on web too) */}
      <div className="mt-5 pt-5 border-t border-subtle">
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={preferences.engagementNotifications}
            onChange={(e) => handlePreferenceChange('engagementNotifications', e.target.checked)}
            className="mt-1 w-4 h-4 rounded border-active bg-hover text-brand focus:ring-brand/50 focus:ring-offset-0 cursor-pointer"
          />
          <div>
            <span className="text-primary text-sm font-medium group-hover:text-brand transition-colors">
              Replies & likes
            </span>
            <p className="text-secondary text-xs">Notify me when someone replies to my comment, or likes my comment or photo</p>
          </div>
        </label>

        {preferences.engagementNotifications && (
          <div className="mt-3 pl-7">
            <label className="text-secondary text-xs font-medium block mb-1.5">Also email me</label>
            <select
              value={preferences.emailFrequency || 'off'}
              onChange={(e) => handlePreferenceChange('emailFrequency', e.target.value)}
              className="text-sm bg-hover border border-active rounded-lg px-2.5 py-1.5 text-primary focus:ring-2 focus:ring-brand/50 focus:outline-none"
            >
              <option value="off">Off</option>
              <option value="immediate">Immediately</option>
            </select>
            <p className="text-muted text-xs mt-1">Daily and weekly digest options are coming later.</p>
          </div>
        )}
      </div>

      {/* Anniversary reminders */}
      <div className="mt-5 pt-5 border-t border-subtle">
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={preferences.anniversaries?.enabled !== false}
            onChange={(e) => handlePreferenceChange('anniversaries', { ...preferences.anniversaries, enabled: e.target.checked })}
            className="mt-1 w-4 h-4 rounded border-active bg-hover text-brand focus:ring-brand/50 focus:ring-offset-0 cursor-pointer"
          />
          <div>
            <span className="text-primary text-sm font-medium group-hover:text-brand transition-colors">
              Anniversary reminders
            </span>
            <p className="text-secondary text-xs">"X years ago today you saw..." — on the exact date, once a year per show</p>
          </div>
        </label>

        {preferences.anniversaries?.enabled !== false && (
          <div className="mt-3 pl-7">
            <label className="text-secondary text-xs font-medium block mb-1.5">Notify me via</label>
            <select
              value={preferences.anniversaries?.method || 'both'}
              onChange={(e) => handlePreferenceChange('anniversaries', { ...preferences.anniversaries, method: e.target.value })}
              className="text-sm bg-hover border border-active rounded-lg px-2.5 py-1.5 text-primary focus:ring-2 focus:ring-brand/50 focus:outline-none"
            >
              <option value="both">Push and email</option>
              <option value="push">Push only</option>
              <option value="email">Email only</option>
            </select>
          </div>
        )}
      </div>

      <AlertPrefs preferences={preferences} onChange={handlePreferenceChange} pushReady={permission === 'granted'} />
    </div>
  );
}
