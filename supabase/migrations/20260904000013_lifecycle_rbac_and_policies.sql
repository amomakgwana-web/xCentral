-- ══════════════════════════════════════════════════════════════
-- Permissions for the lifecycle domains, and default lending policy.
--
-- The new capabilities are genuinely different jobs from verification,
-- and giving them their own permissions is what lets a dealership put
-- a collections clerk on payments without also handing them the power
-- to originate agreements or clear a fraud alert.
-- ══════════════════════════════════════════════════════════════

insert into public.permissions (id, description) values
  ('customers',  'Create and manage customer records'),
  ('contracts',  'Originate and manage credit agreements'),
  ('payments',   'Record and reverse payments, and work arrears'),
  ('fraud',      'Run fraud screens, dismiss signals and resolve alerts')
on conflict (id) do nothing;

-- Two roles the lifecycle work needs and verification did not.
insert into public.roles (id, name, description) values
  ('fraud_analyst', 'Fraud Analyst',
   'Investigates alerts, dismisses signals, confirms fraud · read-only elsewhere'),
  ('collections',   'Collections',
   'Payments, arrears and customer contact · cannot originate or decide credit'),
  ('dealer_admin',  'Dealer Admin',
   'Full customer, asset and contract management for one platform')
on conflict (id) do nothing;

insert into public.role_permissions (role_id, permission_id) values
  ('super_admin','customers'), ('super_admin','contracts'),
  ('super_admin','payments'),  ('super_admin','fraud'),

  -- Verification officers onboard the customers they verified.
  ('verification_officer','customers'),

  -- Compliance owns fraud alongside consent and audit.
  ('compliance_officer','fraud'), ('compliance_officer','customers'),

  -- Credit analysts size and write the agreements.
  ('credit_analyst','customers'), ('credit_analyst','contracts'),

  ('fraud_analyst','fraud'), ('fraud_analyst','customers'), ('fraud_analyst','audit'),

  ('collections','payments'), ('collections','customers'),

  ('dealer_admin','customers'), ('dealer_admin','contracts'),
  ('dealer_admin','payments'),  ('dealer_admin','identity'), ('dealer_admin','documents')
on conflict do nothing;

-- Default lending policies are seeded in supabase/seed_lifecycle.sql,
-- not here: this migration runs before any platform exists, so a
-- select over client_platforms would insert nothing at all.
