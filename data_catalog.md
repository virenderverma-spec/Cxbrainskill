# Data Catalog: prod_catalog

This document describes the tables in `prod_catalog.customer_support` and `prod_catalog.telco` schemas, including their columns, data types, and join relationships.

---

## Table of Contents

1. [Customer Support Schema](#customer-support-schema)
   - [zendesk_tickets](#zendesk_tickets)
   - [zendesk_ticket_metrics](#zendesk_ticket_metrics)
2. [Telco Schema](#telco-schema)
   - [Customer Domain](#customer-domain)
   - [Product Order Domain](#product-order-domain)
   - [Payment Domain](#payment-domain)
   - [Usage Domain](#usage-domain)
   - [Events](#events)
3. [Join Keys Reference](#join-keys-reference)
4. [Entity Relationship Diagram](#entity-relationship-diagram)

---

## Customer Support Schema

### zendesk_tickets

**Description:** Core Zendesk support ticket data containing ticket details, status, and customer information.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier of the ticket |
| `url` | string | API URL of the ticket resource |
| `external_id` | string | External ID for mapping to local records |
| `via` | string | Channel and source details (JSON) |
| `created_at` | timestamp | Ticket creation timestamp |
| `updated_at` | timestamp | Last update timestamp |
| `generated_timestamp` | bigint | Unix timestamp of most recent update |
| `type` | string | Ticket type: problem, incident, question, task |
| `subject` | string | Subject line of the ticket |
| `raw_subject` | string | Original subject before dynamic content substitution |
| `description` | string | First comment/description |
| `priority` | string | Priority: urgent, high, normal, low |
| `status` | string | Status: new, open, pending, hold, solved, closed |
| `recipient` | string | Original recipient email address |
| `requester_id` | bigint | User ID of the requester |
| `submitter_id` | bigint | User ID who submitted the ticket |
| `assignee_id` | bigint | User ID of the assigned agent |
| `organization_id` | bigint | Organization ID of the requester |
| `group_id` | bigint | Assigned group ID |
| `collaborator_ids` | string | Array of CC'ed user IDs |
| `follower_ids` | string | Array of follower user IDs |
| `email_cc_ids` | string | Array of email CC user IDs |
| `forum_topic_id` | bigint | Forum topic ID |
| `problem_id` | bigint | Linked problem ID for incident tickets |
| `has_incidents` | boolean | True if problem ticket has linked incidents |
| `is_public` | boolean | True if ticket has public comments |
| `due_at` | timestamp | Due date for task-type tickets |
| `tags` | string | Array of tag strings |
| `custom_fields` | string | Custom field values (JSON) |
| `satisfaction_rating` | string | Satisfaction rating data (JSON) |
| `sharing_agreement_ids` | string | Array of sharing agreement IDs |
| `custom_status_id` | bigint | Custom status ID |
| `encoded_id` | string | Short ticket ID for public reference |
| `fields` | string | Ticket field values (JSON) |
| `followup_ids` | string | Array of follow-up ticket IDs |
| `ticket_form_id` | bigint | Ticket form ID |
| `brand_id` | bigint | Associated brand ID |
| `allow_channelback` | boolean | True if channelback is enabled |
| `allow_attachments` | boolean | True if agents can add attachments |
| `from_messaging_channel` | boolean | True if from messaging channel |

---

### zendesk_ticket_metrics

**Description:** Performance metrics for Zendesk tickets including response times, resolution times, and SLA data.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier for the metric record |
| `ticket_id` | string | **Foreign Key → zendesk_tickets.id** |
| `url` | string | API URL to access this metric record |
| `created_at` | timestamp | When this metric record was created |
| `updated_at` | timestamp | When this metric record was last updated |
| `group_stations` | int | Number of groups this ticket passed through |
| `assignee_stations` | int | Number of assignees this ticket had |
| `reopens` | int | Total number of times the ticket was reopened |
| `replies` | int | Number of public replies by agents |
| `assignee_updated_at` | timestamp | When the assignee last updated the ticket |
| `requester_updated_at` | timestamp | When requester last updated the ticket |
| `status_updated_at` | timestamp | When ticket status was last updated |
| `initially_assigned_at` | timestamp | When ticket was first assigned |
| `assigned_at` | timestamp | When ticket was last assigned |
| `solved_at` | timestamp | When ticket was marked as solved |
| `latest_comment_added_at` | timestamp | When latest comment was added |
| `reply_time_in_minutes` | string | First reply time metrics (JSON with calendar/business time) |
| `reply_time_in_seconds` | string | First reply time metrics in seconds (JSON) |
| `first_resolution_time_in_minutes` | string | First resolution time metrics (JSON) |
| `full_resolution_time_in_minutes` | string | Full resolution time metrics (JSON) |
| `agent_wait_time_in_minutes` | string | Agent wait time metrics (JSON) |
| `requester_wait_time_in_minutes` | string | Requester wait time metrics (JSON) |
| `on_hold_time_in_minutes` | string | Time ticket spent on hold (JSON) |
| `custom_status_updated_at` | timestamp | When custom status was last updated |

---

## Telco Schema

### Customer Domain

#### customer

**Description:** Core customer entity containing basic customer information and status.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier for the customer |
| `href` | string | Customer reference URL |
| `name` | string | Customer name |
| `status` | string | **Partition Key.** Status: Initialized, Activated, Approved, Suspended, Cancelled |
| `status_reason` | string | Status reason |
| `engaged_party_role` | string | Related party role |
| `engaged_party_href` | string | Related party reference URL |
| `engaged_party_id` | string | Related party ID (links to individual/party) |
| `engaged_party_name` | string | Related party name |
| `created_at` | timestamp | Creation timestamp |
| `updated_at` | timestamp | Last update timestamp |

---

#### customer_account

**Description:** Customer billing/service accounts.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier for the account |
| `customer_id` | string | **Foreign Key → customer.id** |
| `description` | string | Account description |
| `href` | string | Account reference URL |
| `name` | string | Account name |
| `created_at` | timestamp | Creation timestamp |

---

#### customer_agreement

**Description:** Customer service agreements and contracts.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier for the agreement |
| `customer_id` | string | **Foreign Key → customer.id** |
| `name` | string | Agreement name |
| `href` | string | Agreement reference URL |
| `created_at` | timestamp | Creation timestamp |

---

#### customer_characteristic

**Description:** Customer attributes and metadata stored as key-value pairs.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Characteristic record ID |
| `customer_id` | string | **Foreign Key → customer.id** |
| `name` | string | Characteristic name |
| `value` | string | Characteristic value |
| `created_at` | timestamp | Creation timestamp |

---

#### customer_contact_medium

**Description:** Customer contact information (email, phone, address).

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Contact method ID |
| `customer_id` | string | **Foreign Key → customer.id** |
| `medium_type` | string | Contact type: email, phone, address, social, fax |
| `preferred` | boolean | Whether this is the preferred contact method |
| `characteristic` | string | Contact method details (JSON) |
| `created_at` | timestamp | Creation timestamp |

---

#### customer_credit_profile

**Description:** Customer credit assessment and scoring data.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Credit record ID |
| `customer_id` | string | **Foreign Key → customer.id** |
| `credit_profile_date` | string | Credit assessment date |
| `credit_risk_rating` | int | Credit risk rating |
| `credit_score` | int | Credit score |
| `created_at` | timestamp | Creation timestamp |
| `updated_at` | timestamp | Last update timestamp |

---

#### customer_payment_method

**Description:** Customer's saved payment methods.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Payment method ID |
| `customer_id` | string | **Foreign Key → customer.id** |
| `href` | string | Payment method reference URL |
| `name` | string | Payment method name |
| `created_at` | timestamp | Creation timestamp |
| `is_active` | boolean | Whether the payment method is active |
| `last_used` | timestamp | Last used timestamp |

---

#### customer_related_party

**Description:** Parties related to a customer (dependents, authorized users, etc.).

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Related party ID |
| `customer_id` | string | **Foreign Key → customer.id** |
| `role` | string | Related party role |
| `href` | string | Related party reference URL |
| `name` | string | Related party name |
| `created_at` | timestamp | Creation timestamp |
| `relationship_type` | string | Relationship type |

---

### Product Order Domain

#### product_order

**Description:** Product orders placed by customers.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier of the order |
| `href` | string | Hyperlink to access the order |
| `order_date` | timestamp | **Partition Key.** Date when the order was created |
| `completion_date` | timestamp | Date when the order was completed |
| `expected_completion_date` | timestamp | Expected delivery date |
| `requested_completion_date` | timestamp | Requested delivery date |
| `state` | string | **Partition Key.** Order status: draft, acknowledged, rejected, pending, held, inProgress, cancelled, completed, failed, partial |
| `cancellation_date` | timestamp | Date when the order was cancelled |
| `cancellation_reason` | string | Reason for cancellation |
| `priority` | string | Priority level |
| `description` | string | Order description |
| `category` | string | Business category |
| `external_id` | string | External ID provided by consumer |
| `notification_contact` | string | Contact for order notifications |
| `created_at` | timestamp | Record creation timestamp |
| `updated_at` | timestamp | Record last update timestamp |

---

#### product_order_item

**Description:** Individual line items within a product order.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier of the order item |
| `order_id` | string | **Foreign Key → product_order.id.** Partition Key. |
| `action` | string | Action: add, modify, delete, noChange |
| `quantity` | int | Ordered quantity |
| `state` | string | **Partition Key.** Order item state |
| `product_id` | string | Associated product ID |
| `product_offering_id` | string | Associated product offering ID |
| `is_sim_required` | boolean | Flag if SIM card is required |
| `appointment_ref` | string | Appointment reference (JSON) |
| `billing_account_ref` | string | Billing account reference (JSON) |
| `created_at` | timestamp | Record creation timestamp |
| `updated_at` | timestamp | Record last update timestamp |

---

#### product_order_party

**Description:** Parties associated with a product order (buyer, seller, etc.).

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Party record ID |
| `order_id` | string | **Foreign Key → product_order.id.** Partition Key. |
| `party_id` | string | Party identifier (can join to customer.engaged_party_id) |
| `href` | string | Party reference URL |
| `name` | string | Party name |
| `role` | string | Role played by the party |
| `created_at` | timestamp | Record creation timestamp |

---

#### product_order_price

**Description:** Pricing information for product orders and order items.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Price record ID |
| `order_id` | string | **Foreign Key → product_order.id.** Partition Key. |
| `item_id` | string | **Foreign Key → product_order_item.id** |
| `price_type` | string | Type: recurring, one-time, subscription, discount, allowance, penalty, upfront, usage |
| `description` | string | Detailed price description |
| `name` | string | Short price name |
| `recurring_charge_period` | string | Billing period for recurring charges |
| `unit_of_measure` | string | Unit of measurement |
| `percentage` | double | Percentage applied |
| `tax_rate` | double | Tax rate percentage |
| `duty_free_amount` | string | Tax excluded amount (JSON) |
| `tax_included_amount` | string | Tax included amount (JSON) |
| `product_offering_price_ref` | string | Product offering price reference (JSON) |
| `price_level` | string | **Partition Key.** Price level: item, item_total, order_total |
| `created_at` | timestamp | Record creation timestamp |

---

#### product_order_characteristic

**Description:** Custom attributes for product orders and order items.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Characteristic record ID |
| `order_id` | string | **Foreign Key → product_order.id.** Partition Key. |
| `item_id` | string | **Foreign Key → product_order_item.id** |
| `name` | string | Characteristic name |
| `value_type` | string | Data type of the value |
| `value` | string | Characteristic value |
| `created_at` | timestamp | Record creation timestamp |

---

#### product_order_note

**Description:** Notes and comments on product orders.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Note record ID |
| `order_id` | string | **Foreign Key → product_order.id.** Partition Key. |
| `author` | string | Note author |
| `date` | timestamp | Note date |
| `text` | string | Note content |
| `created_at` | timestamp | Record creation timestamp |

---

#### product_order_ref_data

**Description:** External references associated with product orders (billing accounts, appointments, etc.).

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Reference record ID |
| `order_id` | string | **Foreign Key → product_order.id.** Partition Key. |
| `item_id` | string | **Foreign Key → product_order_item.id** |
| `ref_type` | string | **Partition Key.** Type: billing_account, appointment, payment, channel, agreement, product, product_offering, resource |
| `ref_id` | string | Reference identifier |
| `href` | string | Reference URL |
| `name` | string | Reference name |
| `role` | string | Role in context |
| `description` | string | Reference description |
| `is_bundle` | boolean | Flag if reference is a bundle |
| `value` | string | Identifying value |
| `relationship_type` | string | Type of relationship |
| `additional_attributes` | string | Additional attributes (JSON) |
| `created_at` | timestamp | Record creation timestamp |

---

#### product_order_relationship

**Description:** Relationships between product orders.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Relationship record ID |
| `order_id` | string | **Foreign Key → product_order.id (source).** Partition Key. |
| `related_order_id` | string | **Foreign Key → product_order.id (target)** |
| `relationship_type` | string | Type of relationship |
| `href` | string | Relationship reference URL |
| `created_at` | timestamp | Record creation timestamp |

---

#### product_order_term

**Description:** Contract terms associated with product orders.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Term record ID |
| `order_id` | string | **Foreign Key → product_order.id** |
| `item_id` | string | **Foreign Key → product_order_item.id** |
| `name` | string | Term name |
| `description` | string | Term description |
| `duration` | string | Term duration details (JSON) |
| `created_at` | timestamp | Record creation timestamp |

---

#### product_item_relationship

**Description:** Relationships between product order items.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Relationship record ID |
| `order_id` | string | **Foreign Key → product_order.id.** Partition Key. |
| `source_item_id` | string | **Foreign Key → product_order_item.id (source)** |
| `target_item_id` | string | **Foreign Key → product_order_item.id (target)** |
| `relationship_type` | string | Type of relationship |
| `created_at` | timestamp | Record creation timestamp |

---

### Payment Domain

#### payment

**Description:** Payment transactions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier for the payment |
| `href` | string | Hypertext reference for the payment |
| `name` | string | Display name for the payment |
| `description` | string | Description of the payment |
| `amount` | string | Payment amount (JSON: currency and value) |
| `tax_amount` | string | Tax amount (JSON) |
| `total_amount` | string | Total payment amount (JSON) |
| `authorization_code` | string | Authorization code from payment gateway |
| `correlator_id` | string | Unique identifier from client for correlation |
| `payment_date` | timestamp | Date when the payment was executed |
| `status` | string | Status: INITIATED, PROCESSING, SUCCEEDED, FAILED, CANCELLED |
| `status_date` | timestamp | Date when the status was recorded |
| `channel_id` | string | **Foreign Key → payment_channel.id** |
| `payer_id` | string | ID of the payer |
| `payment_method_id` | string | **Foreign Key → payment_method.id** |
| `payment_item` | string | List of payment items (JSON) |
| `account_id` | string | ID of the associated account |
| `created_at` | timestamp | Record creation timestamp |
| `updated_at` | timestamp | Record last update timestamp |

---

#### payment_item

**Description:** Individual items within a payment.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier for the payment item |
| `payment_id` | string | **Foreign Key → payment.id** |
| `total_amount` | string | Total amount for the item (JSON) |
| `tax_amount` | string | Tax amount for the item (JSON) |
| `amount` | string | Base amount for the item (JSON) |

---

#### payment_channel

**Description:** Payment channels (web, mobile, in-store, etc.).

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier for the channel |
| `href` | string | Reference URL for the channel |
| `name` | string | Name of the channel |

---

#### payment_method

**Description:** Available payment methods.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier for the payment method |
| `href` | string | Reference URL for the payment method |
| `name` | string | Name of the payment method |
| `payment_type_id` | string | **Foreign Key → payment_method_type.id** |
| `is_default` | boolean | Whether this is the default payment method |
| `is_active` | boolean | Whether this payment method is active |
| `created_at` | timestamp | Record creation timestamp |
| `updated_at` | timestamp | Record last update timestamp |

---

#### payment_method_type

**Description:** Types of payment methods (credit card, bank transfer, etc.).

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier for the payment method type |
| `name` | string | Name of the payment method type |
| `description` | string | Description of the payment method type |
| `is_active` | boolean | Whether this payment method type is enabled |
| `created_at` | timestamp | Record creation timestamp |
| `updated_at` | timestamp | Record last update timestamp |

---

#### payment_method_attribute

**Description:** Attribute definitions for payment method types.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier for the attribute |
| `payment_type_id` | string | **Foreign Key → payment_method_type.id** |
| `attribute_name` | string | Technical name of the attribute |
| `attribute_label` | string | Display name of the attribute |
| `required` | boolean | Whether this attribute is mandatory |
| `data_type` | string | Data type: string, number, date, boolean, json |
| `validation_regex` | string | Regular expression for validation |
| `sort_order` | int | Display order of the attribute |
| `created_at` | timestamp | Record creation timestamp |
| `updated_at` | timestamp | Record last update timestamp |

---

#### payment_method_attribute_value

**Description:** Actual attribute values for payment methods.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier for the attribute value |
| `payment_method_id` | string | **Foreign Key → payment_method.id** |
| `payment_attribute_id` | string | **Foreign Key → payment_method_attribute.id** |
| `value` | string | Actual value of the attribute |
| `created_at` | timestamp | Record creation timestamp |
| `updated_at` | timestamp | Record last update timestamp |

---

### Usage Domain

#### usage_main

**Description:** Core usage records (voice, data, SMS, etc.).

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier of the usage record |
| `href` | string | Hyperlink reference to the usage record |
| `description` | string | Textual description of the usage |
| `usage_date` | timestamp | **Partition Key.** Date and time when the usage occurred |
| `usage_type` | string | Type of usage: voice, data, SMS |
| `status` | string | **Partition Key.** Current status of the usage record |
| `usage_specification_id` | string | Reference ID to usage specification |
| `usage_specification_href` | string | Hyperlink to usage specification |
| `usage_specification_name` | string | Name of the usage specification |
| `type_` | string | The class type of the usage record |
| `base_type` | string | The base type for extension purposes |
| `schema_location` | string | URL of the JSON schema |
| `create_at` | timestamp | Creation timestamp |
| `update_at` | timestamp | Last update timestamp |

---

#### usage_characteristic

**Description:** Attributes of usage records.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier of the characteristic |
| `usage_id` | string | **Foreign Key → usage_main.id.** Partition Key. |
| `name` | string | Name of the characteristic |
| `value` | string | Value of the characteristic (JSON) |
| `value_type` | string | Type of the characteristic value |
| `type_` | string | The class type of the characteristic |
| `base_type` | string | The base type for extension purposes |
| `schema_location` | string | URL of the JSON schema |
| `create_at` | timestamp | Creation timestamp |

---

#### usage_characteristic_relationship

**Description:** Relationships between usage characteristics.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier of the relationship |
| `characteristic_id` | string | **Foreign Key → usage_characteristic.id** |
| `usage_id` | string | **Foreign Key → usage_main.id.** Partition Key. |
| `relationship_type` | string | Type of the characteristic relationship |
| `create_at` | timestamp | Creation timestamp |

---

#### usage_rated_product

**Description:** Rated/billed product usage records.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier of the rated product usage |
| `usage_id` | string | **Foreign Key → usage_main.id.** Partition Key. |
| `is_billed` | boolean | Flag if this product usage has been billed |
| `is_tax_exempt` | boolean | Flag if this product usage is tax exempt |
| `offer_tariff_type` | string | Type of tariff applied |
| `product_ref_id` | string | Reference ID to the product |
| `product_ref_href` | string | Hyperlink reference to the product |
| `product_ref_name` | string | Name of the product |
| `rating_amount_type` | string | Type of rating amount applied |
| `rating_date` | timestamp | Date and time when the rating occurred |
| `tax_excluded_rating_amount_unit` | string | Currency unit for tax excluded amount |
| `tax_excluded_rating_amount_value` | double | Value of tax excluded amount |
| `tax_included_rating_amount_unit` | string | Currency unit for tax included amount |
| `tax_included_rating_amount_value` | double | Value of tax included amount |
| `tax_rate` | double | Tax rate applied |
| `usage_rating_tag` | string | Tag for categorizing the usage rating |
| `bucket_value_converted_in_amount_unit` | string | Currency unit for converted bucket value |
| `bucket_value_converted_in_amount_value` | double | Value of converted bucket amount |
| `type_` | string | The class type |
| `base_type` | string | The base type for extension purposes |
| `schema_location` | string | URL of the JSON schema |
| `create_at` | timestamp | Creation timestamp |

---

#### usage_related_party

**Description:** Parties related to usage records.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string | **Primary Key.** Unique identifier of the related party |
| `usage_id` | string | **Foreign Key → usage_main.id.** Partition Key. |
| `name` | string | Name of the related party |
| `role` | string | Role of the related party |
| `type_` | string | The class type of the related party |
| `referred_type` | string | The actual type of the referred party |
| `href` | string | Hyperlink reference to the party details |
| `base_type` | string | The base type for extension purposes |
| `schema_location` | string | URL of the JSON schema |
| `create_at` | timestamp | Creation timestamp |

---

### Events

#### eventhub_events

**Description:** Event stream data from Azure Event Hub for real-time processing.

| Column | Type | Description |
|--------|------|-------------|
| `event_id` | string | **Primary Key.** Unique event identifier |
| `tenant_id` | string | Tenant identifier |
| `event_type` | string | Event type (e.g., BillingAccountCreateEvent) |
| `event_time` | timestamp | **Partition Key.** Event generation timestamp |
| `correlation_id` | string | Optional field for correlating related events |
| `domain` | string | Event domain/category: Billing, Customer, etc. |
| `title` | string | Brief description of the event |
| `description` | string | Detailed description of the event |
| `priority` | string | Event priority: High, Medium, Low |
| `time_occurred` | timestamp | Actual occurrence time of the event |
| `event` | string | Event payload (JSON) |
| `created_at` | timestamp | Record creation time (data ingestion time) |

---

## Join Keys Reference

### Customer Support Schema Joins

| Source Table | Source Column | Target Table | Target Column | Relationship |
|--------------|---------------|--------------|---------------|--------------|
| zendesk_ticket_metrics | ticket_id | zendesk_tickets | id | Many-to-One |

### Telco Schema - Customer Domain Joins

| Source Table | Source Column | Target Table | Target Column | Relationship |
|--------------|---------------|--------------|---------------|--------------|
| customer_account | customer_id | customer | id | Many-to-One |
| customer_agreement | customer_id | customer | id | Many-to-One |
| customer_characteristic | customer_id | customer | id | Many-to-One |
| customer_contact_medium | customer_id | customer | id | Many-to-One |
| customer_credit_profile | customer_id | customer | id | Many-to-One |
| customer_payment_method | customer_id | customer | id | Many-to-One |
| customer_related_party | customer_id | customer | id | Many-to-One |

### Telco Schema - Product Order Domain Joins

| Source Table | Source Column | Target Table | Target Column | Relationship |
|--------------|---------------|--------------|---------------|--------------|
| product_order_item | order_id | product_order | id | Many-to-One |
| product_order_party | order_id | product_order | id | Many-to-One |
| product_order_party | party_id | customer | engaged_party_id | Many-to-One |
| product_order_price | order_id | product_order | id | Many-to-One |
| product_order_price | item_id | product_order_item | id | Many-to-One |
| product_order_characteristic | order_id | product_order | id | Many-to-One |
| product_order_characteristic | item_id | product_order_item | id | Many-to-One |
| product_order_note | order_id | product_order | id | Many-to-One |
| product_order_ref_data | order_id | product_order | id | Many-to-One |
| product_order_ref_data | item_id | product_order_item | id | Many-to-One |
| product_order_relationship | order_id | product_order | id | Many-to-One |
| product_order_relationship | related_order_id | product_order | id | Many-to-One |
| product_order_term | order_id | product_order | id | Many-to-One |
| product_order_term | item_id | product_order_item | id | Many-to-One |
| product_item_relationship | order_id | product_order | id | Many-to-One |
| product_item_relationship | source_item_id | product_order_item | id | Many-to-One |
| product_item_relationship | target_item_id | product_order_item | id | Many-to-One |

### Telco Schema - Payment Domain Joins

| Source Table | Source Column | Target Table | Target Column | Relationship |
|--------------|---------------|--------------|---------------|--------------|
| payment | channel_id | payment_channel | id | Many-to-One |
| payment | payment_method_id | payment_method | id | Many-to-One |
| payment_item | payment_id | payment | id | Many-to-One |
| payment_method | payment_type_id | payment_method_type | id | Many-to-One |
| payment_method_attribute | payment_type_id | payment_method_type | id | Many-to-One |
| payment_method_attribute_value | payment_method_id | payment_method | id | Many-to-One |
| payment_method_attribute_value | payment_attribute_id | payment_method_attribute | id | Many-to-One |

### Telco Schema - Usage Domain Joins

| Source Table | Source Column | Target Table | Target Column | Relationship |
|--------------|---------------|--------------|---------------|--------------|
| usage_characteristic | usage_id | usage_main | id | Many-to-One |
| usage_characteristic_relationship | usage_id | usage_main | id | Many-to-One |
| usage_characteristic_relationship | characteristic_id | usage_characteristic | id | Many-to-One |
| usage_rated_product | usage_id | usage_main | id | Many-to-One |
| usage_related_party | usage_id | usage_main | id | Many-to-One |

---

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              CUSTOMER SUPPORT SCHEMA                                      │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   ┌──────────────────────┐         ┌──────────────────────────┐                         │
│   │   zendesk_tickets    │ 1 ───── n │ zendesk_ticket_metrics  │                         │
│   │──────────────────────│         │──────────────────────────│                         │
│   │ PK: id               │         │ PK: id                   │                         │
│   │ status               │         │ FK: ticket_id            │                         │
│   │ priority             │         │ reopens, replies         │                         │
│   │ type                 │         │ resolution times         │                         │
│   └──────────────────────┘         └──────────────────────────┘                         │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    TELCO SCHEMA                                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   ┌─────────────────┐                                                                   │
│   │    customer     │                                                                   │
│   │─────────────────│                                                                   │
│   │ PK: id          │                                                                   │
│   │ engaged_party_id├───────────────────────────────────┐                               │
│   │ status          │                                   │                               │
│   └────────┬────────┘                                   │                               │
│            │ 1                                          │                               │
│            │                                            │                               │
│   ┌────────┴────────┬──────────────────┬────────────────┤                               │
│   │ n               │ n                │ n              │ n                             │
│   ▼                 ▼                  ▼                ▼                               │
│ ┌──────────────┐ ┌─────────────────┐ ┌──────────────┐ ┌────────────────┐                │
│ │customer_     │ │customer_        │ │customer_     │ │customer_       │                │
│ │account       │ │contact_medium   │ │agreement     │ │characteristic  │                │
│ └──────────────┘ └─────────────────┘ └──────────────┘ └────────────────┘                │
│                                                                                          │
│ ┌──────────────┐ ┌─────────────────┐ ┌──────────────┐                                   │
│ │customer_     │ │customer_        │ │customer_     │                                   │
│ │credit_profile│ │payment_method   │ │related_party │                                   │
│ └──────────────┘ └─────────────────┘ └──────────────┘                                   │
│                                                                                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   ┌─────────────────┐         ┌────────────────────┐                                    │
│   │  product_order  │ 1 ───── n│ product_order_item │                                    │
│   │─────────────────│         │────────────────────│                                    │
│   │ PK: id          │         │ PK: id             │                                    │
│   │ state           │         │ FK: order_id       │                                    │
│   │ order_date      │         │ product_id         │                                    │
│   └────────┬────────┘         └──────────┬─────────┘                                    │
│            │ 1                           │ 1                                            │
│   ┌────────┼────────┬────────────┐       │                                              │
│   │ n      │ n      │ n          │ n     │ n                                            │
│   ▼        ▼        ▼            ▼       ▼                                              │
│ ┌──────┐ ┌──────┐ ┌──────────┐ ┌─────┐ ┌──────────────────────┐                         │
│ │party │ │price │ │character.│ │note │ │product_order_price   │                         │
│ │      │ │      │ │          │ │     │ │(item_id → item.id)   │                         │
│ └──────┘ └──────┘ └──────────┘ └─────┘ └──────────────────────┘                         │
│                                                                                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   ┌─────────────────┐         ┌────────────────────┐                                    │
│   │    payment      │ 1 ───── n│   payment_item     │                                    │
│   │─────────────────│         │────────────────────│                                    │
│   │ PK: id          │         │ PK: id             │                                    │
│   │ FK: channel_id  │         │ FK: payment_id     │                                    │
│   │ FK: method_id   │         └────────────────────┘                                    │
│   └────────┬────────┘                                                                   │
│            │                                                                            │
│   ┌────────┴────────┐                                                                   │
│   ▼                 ▼                                                                   │
│ ┌──────────────┐ ┌────────────────┐     ┌────────────────────────┐                      │
│ │payment_      │ │payment_method  │ ──── │payment_method_type     │                      │
│ │channel       │ │                │     │                        │                      │
│ └──────────────┘ └───────┬────────┘     └───────────┬────────────┘                      │
│                          │ 1                        │ 1                                 │
│                          │                          │                                   │
│                          ▼ n                        ▼ n                                 │
│            ┌──────────────────────────┐  ┌────────────────────────┐                     │
│            │payment_method_attr_value │  │payment_method_attribute│                     │
│            └──────────────────────────┘  └────────────────────────┘                     │
│                                                                                          │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   ┌─────────────────┐         ┌────────────────────────┐                                │
│   │   usage_main    │ 1 ───── n│ usage_characteristic   │                                │
│   │─────────────────│         │────────────────────────│                                │
│   │ PK: id          │         │ PK: id                 │                                │
│   │ usage_type      │         │ FK: usage_id           │                                │
│   │ status          │         └────────────────────────┘                                │
│   └────────┬────────┘                                                                   │
│            │ 1                                                                          │
│   ┌────────┼────────┐                                                                   │
│   │ n      │ n      │ n                                                                 │
│   ▼        ▼        ▼                                                                   │
│ ┌──────────────┐ ┌───────────────────┐ ┌──────────────────────────┐                     │
│ │usage_rated_  │ │usage_related_     │ │usage_characteristic_     │                     │
│ │product       │ │party              │ │relationship              │                     │
│ └──────────────┘ └───────────────────┘ └──────────────────────────┘                     │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Common Query Patterns

### 1. Get Customer with All Details

```sql
SELECT
    c.*,
    cm.medium_type,
    cm.characteristic as contact_details,
    cc.name as char_name,
    cc.value as char_value
FROM prod_catalog.telco.customer c
LEFT JOIN prod_catalog.telco.customer_contact_medium cm ON c.id = cm.customer_id
LEFT JOIN prod_catalog.telco.customer_characteristic cc ON c.id = cc.customer_id
WHERE c.id = '<customer_id>'
```

### 2. Get Order with Items and Pricing

```sql
SELECT
    po.*,
    poi.id as item_id,
    poi.product_id,
    poi.quantity,
    poi.state as item_state,
    pop.price_type,
    pop.tax_included_amount
FROM prod_catalog.telco.product_order po
JOIN prod_catalog.telco.product_order_item poi ON po.id = poi.order_id
LEFT JOIN prod_catalog.telco.product_order_price pop ON po.id = pop.order_id AND poi.id = pop.item_id
WHERE po.id = '<order_id>'
```

### 3. Get Zendesk Ticket with Metrics

```sql
SELECT
    t.*,
    m.reopens,
    m.replies,
    m.full_resolution_time_in_minutes,
    m.solved_at
FROM prod_catalog.customer_support.zendesk_tickets t
LEFT JOIN prod_catalog.customer_support.zendesk_ticket_metrics m ON t.id = m.ticket_id
WHERE t.id = '<ticket_id>'
```

### 4. Link Customer to Order (via party_id)

```sql
SELECT
    c.id as customer_id,
    c.name as customer_name,
    po.id as order_id,
    po.state as order_state,
    po.order_date
FROM prod_catalog.telco.customer c
JOIN prod_catalog.telco.product_order_party pop ON c.engaged_party_id = pop.party_id
JOIN prod_catalog.telco.product_order po ON pop.order_id = po.id
WHERE c.id = '<customer_id>'
```

---

## Cross-Schema Join Keys

To join data between `customer_support` and `telco` schemas, you would typically need:

1. **External ID mapping**: The `zendesk_tickets.external_id` field may contain customer identifiers
2. **Custom fields**: The `zendesk_tickets.custom_fields` JSON may contain customer/order references
3. **Email matching**: Match `zendesk_tickets.recipient` with customer contact email

```sql
-- Example: Find tickets for a customer by email
SELECT
    t.id as ticket_id,
    t.subject,
    t.status,
    c.id as customer_id,
    c.name as customer_name
FROM prod_catalog.customer_support.zendesk_tickets t
JOIN prod_catalog.telco.customer_contact_medium cm
    ON t.recipient = JSON_EXTRACT_SCALAR(cm.characteristic, '$.email_address')
JOIN prod_catalog.telco.customer c ON cm.customer_id = c.id
WHERE cm.medium_type = 'email'
```

---

*Generated: 2026-01-23*
