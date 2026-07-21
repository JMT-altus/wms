-- 0067 — JMT Drive Solutions: clear all Altus-era seed rosters.
--
-- Earlier migrations (0012/0022/0023/0025/0056/0063) seeded roster/index tables
-- with Altus Corp's real clients, subjects, departments, products, and internal
-- Google-Drive index links. JMT must start with empty pickers and add its own
-- data via the admin UI, so this migration empties those tables.
--
-- Task-status config (status_settings) and org_settings are intentionally kept:
-- they are generic app configuration, not Altus business data.
--
-- Idempotent + safe: no employees/tasks reference these rows on a fresh JMT DB,
-- and DELETE re-runs harmlessly. Children deleted before parents (FKs).

delete from index_links;
delete from index_sections;
delete from clients;
delete from subjects;
delete from product_options;

-- employee_departments (join) is empty on a fresh JMT DB; clear it before
-- departments in case any seed linked rows exist.
delete from employee_departments;
delete from departments;
