// Authentication and authorization. Identity comes from Google, never from the client.
// 1. Google Workspace (same domain, web app executing as the deployer): Session.getActiveUser().
// 2. Any Google account: the browser sends a Google Identity Services ID token, verified here
//    against Google's tokeninfo endpoint (audience = CLIENT_ID, verified e-mail, not expired).

function currentUser_(req) {
  let email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (e) { email = ''; }
  if (!email && req && typeof req.idToken === 'string' && req.idToken) email = verifyIdToken_(req.idToken);
  if (!email) throw new ApiError('UNAUTHENTICATED', 'Sign in with your Google account to use the server.');
  return String(email).trim().toLowerCase();
}
function verifyIdToken_(token) {
  const clientId = prop_('CLIENT_ID', '');
  if (!clientId || token.length > 4096) return '';
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), {muteHttpExceptions: true});
  if (res.getResponseCode() !== 200) return '';
  let j;
  try { j = JSON.parse(res.getContentText()); } catch (e) { return ''; }
  const issuerOk = j.iss === 'accounts.google.com' || j.iss === 'https://accounts.google.com';
  if (j.aud !== clientId || !issuerOk || String(j.email_verified) !== 'true' || !(Number(j.exp) * 1000 > Date.now())) return '';
  return j.email || '';
}
const listProp_ = key => prop_(key, '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const isAdmin_ = user => listProp_('ADMINS').includes(user);
function canCreate_(user) { const c = listProp_('CREATORS'); return isAdmin_(user) || c.includes('*') || c.includes(user); }
// Role on a project: 'admin' (global), 'estimator', 'reviewer', or null
function roleOf_(user, projectId) {
  if (isAdmin_(user)) return 'admin';
  const m = rows_('Members').find(r => r.projectId === projectId && r.email === user);
  return m ? m.role : null;
}
function requireRole_(user, projectId, allowed) {
  const role = roleOf_(user, projectId);
  if (!role || (role !== 'admin' && !allowed.includes(role))) throw new ApiError('FORBIDDEN', `Your role on this project (${role || 'none'}) does not allow this.`);
  return role;
}
function requireAdmin_(user) { if (!isAdmin_(user)) throw new ApiError('FORBIDDEN', 'Only an administrator can do this.'); }
