# ACORD Life (TXLife) – Customer / Party Modeling Notes

## Core Principle

* **Party = Customer master record**
* **LifeParticipant = Role in policy**
* **Relation = Relationship between parties**
* Customer data is **never stored in Policy or LifeParticipant**

---

## Party (Customer)

* One `<Party>` per real-world person or organization
* Reusable across policies
* Identified by `Party/@id`
* Party does **not** imply insured, owner, or applicant

---

## Person vs Organization

* A Party contains **either**:

  * `<Person>` (individual)
  * `<Organization>` (trust, company, employer)
* Never both in the same Party

---

## Personal Information

* Stored under `Party/Person`
* Includes:

  * Name
  * Date of birth
  * Gender
  * Marital status
  * Citizenship / residency
* Do not duplicate personal data elsewhere

---

## Government / Legal Identifiers

* Stored directly under `Party`
* Examples:

  * SSN
  * Tax ID
  * National ID
* Use `GovtID` with type code (`tc`)
* A Party may have multiple identifiers

---

## Address

* Stored under `Party/Address`
* A Party may have multiple addresses
* `AddressTypeCode` is mandatory
* Common types:

  * Residence
  * Mailing
  * Business
* Address is never stored under Person or Policy

---

## Communication (Phone, Email, etc.)

* Stored under `Party/Communication`
* Each entry must have:

  * CommunicationTypeCode (email, phone, fax)
  * CommunicationUseCode (home, mobile, business)
* Multiple communication methods allowed per Party

---

## Employment

* Stored under `Party/Employment`
* Includes:

  * Employment status
  * Occupation
  * Employer name
* Used primarily for underwriting
* Do not store employment under Policy

---

## Financial Information

* Stored under `Party/FinancialInfo`
* May include:

  * Annual income
  * Net worth
  * Assets
* Used for suitability and compliance
* Currency should be specified where applicable

---

## Roles (LifeParticipant)

* Stored under `Policy/LifeParticipant`
* References Party using `PartyID`
* Contains **role only**, no personal data
* Common roles:

  * Applicant
  * Owner
  * Insured
  * Payor
  * Beneficiary
* One Party may have multiple roles

---

## Relationships (Relation)

* Stored under `OLifE/Relation`
* Explicitly defines relationships between Parties
* Uses:

  * `OriginatingObjectID`
  * `RelatedObjectID`
  * `RelationRoleCode`
* Direction matters
* Required when multiple parties are involved

---

## Data Ownership Rules

| Data Type                    | Location        |
| ---------------------------- | --------------- |
| Name, DOB, Gender            | Party / Person  |
| SSN / Tax ID                 | Party           |
| Address                      | Party           |
| Phone / Email                | Party           |
| Employment                   | Party           |
| Financial info               | Party           |
| Role in policy               | LifeParticipant |
| Relationship between parties | Relation        |

---

## Validation Best Practices

* Party must exist before being referenced
* Insured must have DOB and gender
* Address must include AddressTypeCode
* Communication must include type and use
* Do not infer relationships from roles
* Do not duplicate customer data

---

## JSON → ACORD Mapping Rule

* If it describes the **customer** → Party
* If it describes the **policy** → Policy
* If it describes **how customers relate** → Relation

---

## Key Takeaway

**Party is the single source of truth for customer data.
Everything else references it by ID.**

---

If you want, I can also:

* Convert this into a **one-page cheat sheet**
* Add **diagram ASCII art** for markdown
* Create a **JSON schema aligned to these rules**
* Add **carrier validation checklist**

Just say the word.
