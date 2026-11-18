// Stimulus sets for the three tasks.

export const APPS = [
  { id: 'camera', name: 'Camera', mono: 'Ca', color: '#4b5563' },
  { id: 'photos', name: 'Photos', mono: 'Po', color: '#d9480f' },
  { id: 'mail', name: 'Mail', mono: 'Ma', color: '#1c7ed6' },
  { id: 'maps', name: 'Maps', mono: 'Mp', color: '#2f9e44' },
  { id: 'music', name: 'Music', mono: 'Mu', color: '#e03170' },
  { id: 'clock', name: 'Clock', mono: 'Cl', color: '#212529' },
  { id: 'notes', name: 'Notes', mono: 'No', color: '#e8a400' },
  { id: 'wallet', name: 'Wallet', mono: 'Wa', color: '#5f3dc4' },
  { id: 'weather', name: 'Weather', mono: 'We', color: '#1098ad' },
  { id: 'phone', name: 'Phone', mono: 'Ph', color: '#37b24d' },
  { id: 'files', name: 'Files', mono: 'Fi', color: '#3b5bdb' },
  { id: 'books', name: 'Books', mono: 'Bk', color: '#f76707' },
  { id: 'health', name: 'Health', mono: 'He', color: '#c2255c' },
  { id: 'news', name: 'News', mono: 'Nw', color: '#c92a2a' },
  { id: 'radio', name: 'Radio', mono: 'Ra', color: '#862e9c' },
  { id: 'stocks', name: 'Stocks', mono: 'St', color: '#495057' },
  { id: 'timer', name: 'Timer', mono: 'Ti', color: '#0b7285' },
  { id: 'tasks', name: 'Tasks', mono: 'Ta', color: '#5c940d' },
  { id: 'chat', name: 'Chat', mono: 'Ch', color: '#099268' },
  { id: 'video', name: 'Video', mono: 'Vi', color: '#a61e4d' },
];

export const NAMES = [
  'Aaliyah Brooks', 'Aaron Park', 'Abigail Chen', 'Adam Novak', 'Aisha Rahman', 'Alejandro Ruiz', 'Amara Okafor',
  'Andre Silva', 'Anika Sharma', 'Ben Carter', 'Bianca Rossi', 'Brandon Lee', 'Caleb Wright', 'Camila Torres',
  'Carlos Mendez', 'Chloe Martin', 'Daniel Kim', 'Daria Ivanova', 'David Cohen', 'Diego Morales', 'Elena Petrova',
  'Eli Walker', 'Emma Johnson', 'Ethan Nguyen', 'Fatima Ali', 'Felix Wagner', 'Gabriel Santos', 'Grace Liu',
  'Hana Sato', 'Hassan Malik', 'Isabel Garcia', 'Ivan Horvat', 'Jack Murphy', 'Jada Thompson', 'Jamal Davis',
  'Jasmine Patel', 'Javier Lopez', 'Julia Becker', 'Kai Tanaka', 'Kenji Watanabe', 'Kiara Singh', 'Laila Haddad',
  'Leo Fischer', 'Lily Evans', 'Lucas Moreau', 'Maya Gupta', 'Mei Wong', 'Mohammed Saleh', 'Nadia Karim',
  'Naomi Fisher', 'Nikhil Rao', 'Noah Bennett', 'Olivia Hughes', 'Omar Farouk', 'Paula Costa', 'Priya Shah',
  'Rafael Duarte', 'Rina Yamada', 'Ryan O\'Brien', 'Sara Lindqvist', 'Sebastian Hall', 'Sofia Romano', 'Tariq Aziz',
  'Thea Nilsen', 'Tomas Kral', 'Uma Desai', 'Victor Hugo Reyes', 'Wei Zhang', 'Ximena Flores', 'Yara Mansour',
  'Yusuf Demir', 'Zara Ahmed', 'Zoe Clark', 'Mateo Jimenez', 'Hiroshi Mori', 'Ingrid Berg', 'Kofi Mensah',
  'Lena Vogel', 'Marco Bianchi', 'Nora Quinn',
];

export const AVATAR_COLORS = ['#3b5bdb', '#0b7285', '#2f9e44', '#e8590c', '#c2255c', '#5f3dc4', '#495057', '#d6336c', '#1098ad', '#5c940d'];

export const SETTINGS = [
  { id: 'network', name: 'Network & internet', color: '#1c7ed6',
    items: ['Wi-Fi', 'Mobile data', 'Hotspot', 'Airplane mode', 'VPN', 'Data saver'] },
  { id: 'devices', name: 'Connected devices', color: '#3b5bdb',
    items: ['Bluetooth', 'Nearby sharing', 'Driving mode', 'Hearing aids', 'Printing', 'NFC'] },
  { id: 'display', name: 'Display', color: '#e8a400',
    items: ['Dark theme', 'Auto brightness', 'Night light', 'Bold text', 'Large text', 'Auto-rotate'] },
  { id: 'sound', name: 'Sound & vibration', color: '#0b7285',
    items: ['Silent mode', 'Vibrate on ring', 'Keyboard clicks', 'Charging sound', 'Dial pad tones', 'Mono audio'] },
  { id: 'notifications', name: 'Notifications', color: '#c92a2a',
    items: ['Email alerts', 'Message previews', 'Lock screen alerts', 'App badges', 'Calendar reminders', 'News digest'] },
  { id: 'privacy', name: 'Privacy', color: '#5f3dc4',
    items: ['Location', 'Camera access', 'Microphone access', 'Ad tracking', 'Usage reports', 'Clipboard alerts'] },
  { id: 'battery', name: 'Battery', color: '#2f9e44',
    items: ['Battery saver', 'Battery percentage', 'Adaptive battery', 'Background apps', 'Fast charging', 'Low-power alerts'] },
  { id: 'accounts', name: 'Accounts & sync', color: '#d9480f',
    items: ['Auto sync', 'Cloud backup', 'Two-step sign-in', 'Password autofill', 'Contact sync', 'Photo sync'] },
];

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
