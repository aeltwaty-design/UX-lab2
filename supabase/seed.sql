-- First admin. Replace the email, run once in the SQL editor, then sign in with an email link.
insert into admins (email) values ('a.eltwaty@walaplus.com') on conflict do nothing;
