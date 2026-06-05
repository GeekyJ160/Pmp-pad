export const fetchGmailMessages = async (accessToken: string, maxResults = 10) => {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch messages');
  return res.json();
};

export const fetchGmailMessageDetails = async (accessToken: string, messageId: string) => {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch message details');
  return res.json();
};

export const sendGmailMessage = async (accessToken: string, subject: string, to: string, body: string) => {
  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject}`,
    '',
    body
  ];
  const message = messageParts.join('\n');
  const encodedMessage = btoa(message).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: encodedMessage,
    }),
  });
  if (!res.ok) throw new Error('Failed to send message');
  return res.json();
};
