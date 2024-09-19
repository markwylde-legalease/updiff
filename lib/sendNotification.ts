import { exec } from 'child_process';

interface NotificationOptions {
  title: string;
  message: string;
  subtitle?: string;
  sound?: boolean;
}

function escapeAppleScriptString(str: string): string {
  return str.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n');
}

function sendNotification(options: NotificationOptions): void {
  const { title, message, subtitle, sound } = options;

  const escapedTitle = escapeAppleScriptString(title);
  const escapedMessage = escapeAppleScriptString(message);
  const escapedSubtitle = subtitle ? escapeAppleScriptString(subtitle) : '';

  let script = `display notification "${escapedMessage}" with title "${escapedTitle}"`;

  if (subtitle) {
    script += ` subtitle "${escapedSubtitle}"`;
  }

  if (sound) {
    script += ' sound name "default"';
  }

  const command = `osascript -e '${script}'`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error sending notification: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`Notification stderr: ${stderr}`);
      return;
    }
    console.log('Notification sent successfully');
  });
}

export default sendNotification;
