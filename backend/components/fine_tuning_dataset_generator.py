"""
Fine-Tuning Dataset Generator for SharePoint RAG
Generates training datasets for insurance domain understanding.

Creates three types of datasets:
1. Domain Routing: Question → Domain classification
2. Answer Generation: Context + Question → Answer
3. Entity Extraction: Text → Insurance entities (optional)

Usage:
    python fine_tuning_dataset_generator.py --task routing --samples 500 --output domain_routing_train.jsonl
    python fine_tuning_dataset_generator.py --task answer --samples 1000 --output answer_generation_train.jsonl
    python fine_tuning_dataset_generator.py --task all --samples 500 --validate
"""

import os
import json
import argparse
import random
import hashlib
from typing import List, Dict, Tuple
from pathlib import Path

# Insurance domains
DOMAINS = [
    "new_application",
    "underwriting",
    "policy_issue",
    "policy_transactions",
    "product_configuration",
    "product_coverages",
    "product_riders",
    "funds",
    "clients",
    "calculations"
]

DOMAIN_DESCRIPTIONS = {
    "new_application": "New insurance applications, ACORD forms, application requirements, submission process",
    "underwriting": "Risk assessment, medical underwriting, underwriting rules, approval process",
    "policy_issue": "Policy issuance, policy delivery, policy documents, issue requirements",
    "policy_transactions": "Policy changes, transactions, updates, amendments, modifications",
    "product_configuration": "Product setup, product features, product structure, product types",
    "product_coverages": "Coverage types, coverage definitions, coverage amounts, coverage rules",
    "product_riders": "Rider options, rider benefits, rider costs, rider eligibility",
    "funds": "Fund options, fund allocation, fund performance, investment choices",
    "clients": "Client information, KYC, AML requirements, client documentation",
    "calculations": "Premium calculations, benefit calculations, withdrawal calculations, surrender values"
}

# Sample questions per domain (for training data generation)
SAMPLE_QUESTIONS = {
    "new_application": [
        "What ACORD forms are required for a new life insurance application?",
        "What information is needed on the application?",
        "How do I submit a new business application?",
        "What are the signature requirements for applications?",
        "What documents must accompany the application?",
        "How long does application processing take?",
        "What is the application workflow?",
        "Who reviews new applications?",
        "What are the application submission guidelines?",
        "How do I correct errors on an application?"
    ],
    "underwriting": [
        "What are the medical underwriting requirements?",
        "How is risk assessed for life insurance?",
        "What are the underwriting classes?",
        "What medical exams are required?",
        "How long does underwriting take?",
        "What information do underwriters need?",
        "What are the underwriting rules for age 65+?",
        "How are pre-existing conditions evaluated?",
        "What are the underwriting approval levels?",
        "How do I request underwriting exceptions?"
    ],
    "policy_issue": [
        "What are the policy issuance requirements?",
        "How is a policy delivered to the client?",
        "What documents are included in the policy package?",
        "How long does policy issue take?",
        "What are the policy issue checklist items?",
        "Who approves policy issuance?",
        "What are the policy numbering conventions?",
        "How do I reissue a policy?",
        "What triggers policy issue?",
        "How do I verify policy issue completion?"
    ],
    "policy_transactions": [
        "How do I process a beneficiary change?",
        "What transactions require signatures?",
        "How do I change a policy address?",
        "What is the process for policy loans?",
        "How do I process a withdrawal request?",
        "What are the transaction processing timelines?",
        "How do I handle transfer of ownership?",
        "What transactions require underwriting?",
        "How do I process premium changes?",
        "What documentation is needed for transactions?"
    ],
    "product_configuration": [
        "What products are available?",
        "How are products configured in the system?",
        "What are the product features?",
        "What are the differences between term and whole life?",
        "How do I find product specifications?",
        "What are the product age limits?",
        "How are product rates determined?",
        "What products allow cash accumulation?",
        "How do I compare product options?",
        "What products are available in each state?"
    ],
    "product_coverages": [
        "What types of coverage are available?",
        "What is covered under the base policy?",
        "What are the coverage amounts?",
        "How is death benefit calculated?",
        "What is not covered by the policy?",
        "What are the coverage limitations?",
        "How do coverage amounts change over time?",
        "What is guaranteed coverage?",
        "How does coverage vary by product?",
        "What coverage is available for children?"
    ],
    "product_riders": [
        "What riders are available?",
        "What does the waiver of premium rider do?",
        "What is the cost of adding riders?",
        "What are the eligibility requirements for riders?",
        "How do I add a rider to an existing policy?",
        "What is an accelerated death benefit rider?",
        "What is a child term rider?",
        "How do riders affect premium?",
        "What riders are available on term policies?",
        "How do I compare rider options?"
    ],
    "funds": [
        "What investment funds are available?",
        "How do I allocate funds?",
        "What are the fund performance metrics?",
        "How do I change fund allocation?",
        "What are the fund fees?",
        "What is the default fund allocation?",
        "How often can I change fund allocation?",
        "What are the risk levels of each fund?",
        "How do I track fund performance?",
        "What funds are available for variable products?"
    ],
    "clients": [
        "What client information is required?",
        "What are the KYC requirements?",
        "What AML checks are needed?",
        "How do I update client information?",
        "What documents prove client identity?",
        "How do I handle foreign nationals?",
        "What are the age requirements for applicants?",
        "How do I verify client address?",
        "What is the client onboarding process?",
        "How do I handle clients in multiple states?"
    ],
    "calculations": [
        "How is premium calculated?",
        "How do I calculate surrender value?",
        "What is the formula for cash value?",
        "How are withdrawals calculated?",
        "How do I calculate death benefit?",
        "What factors affect premium calculations?",
        "How is interest credited?",
        "How are dividends calculated?",
        "What is the loan interest rate?",
        "How do I calculate required minimum distributions?"
    ]
}

# Sample contexts (synthetic document excerpts)
SAMPLE_CONTEXTS = {
    "new_application": [
        "All new life insurance applications must include ACORD Form 101 (Life Application) and ACORD Form 102 (Health Supplement). Applications must be signed by the proposed insured and the owner (if different). Electronic signatures are accepted if they meet ESIGN Act requirements.",
        "The application process begins with the agent completing the application form with the client. All questions must be answered completely and accurately. Missing information will result in application rejection. The application must be submitted within 30 days of signature.",
        "Applications for amounts over $1,000,000 require additional documentation including financial statements, tax returns, and a detailed financial questionnaire. All applications are reviewed by the New Business department within 2 business days of receipt."
    ],
    "underwriting": [
        "Medical underwriting is required for all applicants age 18-70. A paramedical exam (blood and urine) is required for face amounts over $250,000. Full medical exam with EKG is required for amounts over $1,000,000 or for applicants over age 60.",
        "Underwriting classes include Preferred Plus, Preferred, Standard Plus, Standard, and Table Rated. Classification is based on health history, family history, lifestyle factors, and medical exam results. Each class has specific criteria documented in the underwriting manual.",
        "Underwriters have authority to approve cases up to $500,000 at Standard or better. Cases above this amount or with substandard ratings require senior underwriter or medical director approval."
    ],
    "policy_issue": [
        "Policy issuance occurs after underwriting approval and receipt of initial premium. The policy must be issued within 10 days of approval. The policy package includes the policy contract, policy schedule, riders, and illustration.",
        "Policy delivery confirmation is required. The agent must meet with the client, review the policy, and obtain a signed delivery receipt. The receipt must be returned to the home office within 30 days.",
        "Policy numbers are assigned at issue using the format: YY-PPPP-NNNNNNN where YY=year, PPPP=product code, NNNNNNN=sequential number."
    ],
    "policy_transactions": [
        "Beneficiary changes can be processed without underwriting if the policy is owner-insured. Changes require form 123 (Beneficiary Change) signed by the owner. Changes are effective on the date the form is signed, not received.",
        "Policy loans are available after the policy has been in force for 2 years. Maximum loan is 90% of cash value. Loan interest rate is 5% annually. Loans can be repaid at any time without penalty.",
        "Address changes require written notification. Form 456 (Address Change) or a signed letter from the owner is acceptable. Allow 10 business days for processing."
    ],
    "product_configuration": [
        "Product ABC-Term offers 10, 15, 20, and 30 year level term periods. Available for ages 18-70 with face amounts from $100,000 to $10,000,000. Includes 5-year level premium guarantee.",
        "Whole Life product WL-100 offers permanent coverage with cash value accumulation. Dividends are paid annually and can be used to purchase paid-up additions, reduce premiums, or taken as cash.",
        "Variable Universal Life product VUL-Flex offers flexible premiums and death benefit with investment fund options. Minimum premium is $1,200 annually. Cash value depends on fund performance."
    ],
    "product_coverages": [
        "Base death benefit is the face amount stated in the policy. Additional coverage may be provided by riders. Death benefit is payable upon receipt of proof of death and completed claim forms.",
        "Living benefits allow access to death benefit prior to death if insured is diagnosed with terminal illness (life expectancy 12 months or less). Maximum living benefit is 80% of death benefit.",
        "Accidental Death Benefit (ADB) rider pays double the face amount if death is due to accident. Excludes deaths due to suicide, war, or aviation (except as passenger)."
    ],
    "product_riders": [
        "Waiver of Premium (WP) rider waives premiums if insured becomes totally disabled for 6 consecutive months. Disability must occur before age 60. Premium waiver continues until recovery or age 65.",
        "Accelerated Death Benefit (ADB) rider allows early payment of death benefit if insured is diagnosed as terminally ill. No additional cost for this rider.",
        "Child Term rider provides term coverage on children age 15 days to 18 years. Converts to permanent coverage at age 25 without evidence of insurability."
    ],
    "funds": [
        "Variable products offer 15 fund choices across 5 risk categories: Conservative (money market, bond), Moderate (balanced), Growth (large cap equity), Aggressive (small cap, international), Specialty (sector funds).",
        "Default allocation for new policies is 60% moderate balanced fund, 40% growth fund. Changes can be made quarterly at no charge. More frequent changes subject to $25 fee.",
        "Fund performance is reported quarterly. All funds are subject to market risk. Past performance does not guarantee future results."
    ],
    "clients": [
        "Client identity must be verified using government-issued photo ID. Acceptable IDs include driver's license, passport, or state ID card. Copy of ID must be retained in file.",
        "Foreign nationals must provide passport and visa documentation. ITIN may be used if SSN is not available. Additional AML screening required for clients from high-risk countries.",
        "All clients must complete Customer Identification Program (CIP) questionnaire. Beneficial ownership information required for entities."
    ],
    "calculations": [
        "Premium is based on age, gender, underwriting class, face amount, and product type. Premium calculations are performed by the rating engine using actuarial tables.",
        "Cash value equals accumulated premiums plus interest, minus cost of insurance and expenses. Interest is credited monthly based on current crediting rate (minimum 2%).",
        "Surrender value equals cash value minus surrender charges. Surrender charges decline over 10 years: 10% year 1, declining 1% per year to 0% year 10."
    ]
}


class FineTuningDatasetGenerator:
    """Generates fine-tuning datasets for insurance domain models."""
    
    def __init__(self, output_dir: str = "fine_tuning_data"):
        """
        Initialize generator.
        
        Args:
            output_dir: Directory to save generated datasets
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
    
    def generate_routing_dataset(self, samples_per_domain: int = 50) -> List[Dict]:
        """
        Generate domain routing training data.
        
        Format: {"messages": [{"role": "system", ...}, {"role": "user", ...}, {"role": "assistant", ...}]}
        
        Args:
            samples_per_domain: Number of samples per domain
            
        Returns:
            List of training examples
        """
        dataset = []
        
        system_prompt = """You are an insurance domain classifier. Given a question about insurance, classify it into one of these domains: new_application, underwriting, policy_issue, policy_transactions, product_configuration, product_coverages, product_riders, funds, clients, calculations. Respond with just the domain name."""
        
        for domain in DOMAINS:
            # Use predefined questions
            questions = SAMPLE_QUESTIONS[domain]
            
            # Generate variations
            for question in questions[:samples_per_domain]:
                example = {
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": question},
                        {"role": "assistant", "content": domain}
                    ]
                }
                dataset.append(example)
            
            # Generate synthetic variations
            base_topics = DOMAIN_DESCRIPTIONS[domain].split(", ")
            for _ in range(samples_per_domain - len(questions)):
                topic = random.choice(base_topics)
                synthetic_question = self._generate_synthetic_question(domain, topic)
                
                example = {
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": synthetic_question},
                        {"role": "assistant", "content": domain}
                    ]
                }
                dataset.append(example)
        
        # Shuffle to mix domains
        random.shuffle(dataset)
        return dataset
    
    def generate_answer_dataset(self, samples_per_domain: int = 100) -> List[Dict]:
        """
        Generate answer generation training data.
        
        Format includes context + question → answer
        
        Args:
            samples_per_domain: Number of samples per domain
            
        Returns:
            List of training examples
        """
        dataset = []
        
        system_prompt = """You are an insurance expert assistant. Answer questions based on the provided context. Be accurate, concise, and helpful. If the context doesn't contain enough information, say so."""
        
        for domain in DOMAINS:
            questions = SAMPLE_QUESTIONS[domain]
            contexts = SAMPLE_CONTEXTS[domain]
            
            for i in range(samples_per_domain):
                question = questions[i % len(questions)]
                context = contexts[i % len(contexts)]
                
                # Generate answer based on context
                answer = self._generate_answer_from_context(question, context)
                
                user_message = f"Context: {context}\n\nQuestion: {question}"
                
                example = {
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message},
                        {"role": "assistant", "content": answer}
                    ]
                }
                dataset.append(example)
        
        random.shuffle(dataset)
        return dataset
    
    def _generate_synthetic_question(self, domain: str, topic: str) -> str:
        """Generate synthetic question variations."""
        templates = [
            f"What are the {topic}?",
            f"How do I handle {topic}?",
            f"Can you explain {topic}?",
            f"What do I need to know about {topic}?",
            f"What are the requirements for {topic}?",
            f"How does {topic} work?",
            f"Tell me about {topic}",
            f"What is the process for {topic}?"
        ]
        return random.choice(templates)
    
    def _generate_answer_from_context(self, question: str, context: str) -> str:
        """
        Generate a plausible answer from context.
        
        In production, you would use GPT-4 to generate high-quality answers.
        This is a simplified version for demonstration.
        """
        # Extract key sentences from context
        sentences = [s.strip() for s in context.split('.') if s.strip()]
        
        if len(sentences) <= 2:
            return context
        
        # Return first 2-3 sentences as answer
        answer_sentences = sentences[:min(3, len(sentences))]
        return '. '.join(answer_sentences) + '.'
    
    def save_dataset(self, dataset: List[Dict], filename: str):
        """Save dataset in JSONL format."""
        filepath = self.output_dir / filename
        with open(filepath, 'w', encoding='utf-8') as f:
            for example in dataset:
                f.write(json.dumps(example) + '\n')
        print(f"✓ Saved {len(dataset)} examples to {filepath}")
    
    def validate_dataset(self, filepath: str) -> Tuple[bool, str]:
        """
        Validate JSONL dataset format.
        
        Returns:
            (is_valid, error_message)
        """
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            if len(lines) == 0:
                return False, "File is empty"
            
            if len(lines) < 10:
                return False, f"Too few examples ({len(lines)}). Minimum 10 required."
            
            for i, line in enumerate(lines):
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    return False, f"Line {i+1}: Invalid JSON"
                
                if "messages" not in obj:
                    return False, f"Line {i+1}: Missing 'messages' field"
                
                messages = obj["messages"]
                if not isinstance(messages, list):
                    return False, f"Line {i+1}: 'messages' must be array"
                
                if len(messages) < 2:
                    return False, f"Line {i+1}: Need at least 2 messages"
                
                for msg in messages:
                    if "role" not in msg or "content" not in msg:
                        return False, f"Line {i+1}: Message missing role/content"
            
            return True, f"✓ Valid dataset with {len(lines)} examples"
        
        except Exception as e:
            return False, f"Validation error: {str(e)}"
    
    def split_train_val(self, dataset: List[Dict], val_ratio: float = 0.1) -> Tuple[List[Dict], List[Dict]]:
        """Split dataset into train and validation sets."""
        random.shuffle(dataset)
        split_idx = int(len(dataset) * (1 - val_ratio))
        return dataset[:split_idx], dataset[split_idx:]


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(description='Generate fine-tuning datasets')
    parser.add_argument('--task', choices=['routing', 'answer', 'all'], required=True,
                       help='Type of dataset to generate')
    parser.add_argument('--samples', type=int, default=50,
                       help='Samples per domain (default: 50)')
    parser.add_argument('--output', type=str, help='Output filename')
    parser.add_argument('--validate', action='store_true',
                       help='Validate generated dataset')
    parser.add_argument('--split-val', type=float, default=0.1,
                       help='Validation split ratio (default: 0.1)')
    
    args = parser.parse_args()
    
    generator = FineTuningDatasetGenerator()
    
    if args.task == 'routing' or args.task == 'all':
        print(f"Generating domain routing dataset ({args.samples} samples per domain)...")
        dataset = generator.generate_routing_dataset(samples_per_domain=args.samples)
        
        # Split train/val
        train_data, val_data = generator.split_train_val(dataset, val_ratio=args.split_val)
        
        # Save
        train_file = args.output if args.output else 'domain_routing_train.jsonl'
        val_file = train_file.replace('_train.', '_val.')
        generator.save_dataset(train_data, train_file)
        generator.save_dataset(val_data, val_file)
        
        # Validate
        if args.validate:
            is_valid, message = generator.validate_dataset(str(generator.output_dir / train_file))
            print(message)
    
    if args.task == 'answer' or args.task == 'all':
        print(f"Generating answer generation dataset ({args.samples} samples per domain)...")
        dataset = generator.generate_answer_dataset(samples_per_domain=args.samples)
        
        # Split train/val
        train_data, val_data = generator.split_train_val(dataset, val_ratio=args.split_val)
        
        # Save
        train_file = args.output if args.output and args.task == 'answer' else 'answer_generation_train.jsonl'
        val_file = train_file.replace('_train.', '_val.')
        generator.save_dataset(train_data, train_file)
        generator.save_dataset(val_data, val_file)
        
        # Validate
        if args.validate:
            is_valid, message = generator.validate_dataset(str(generator.output_dir / train_file))
            print(message)
    
    print("\n✓ Dataset generation complete")
    print(f"\nNext steps:")
    print(f"1. Review datasets in fine_tuning_data/ directory")
    print(f"2. Upload to Azure OpenAI: python fine_tuning_manager.py upload --file domain_routing_train.jsonl")
    print(f"3. Create fine-tuning job: python fine_tuning_manager.py create --training-file <file-id> --model gpt-35-turbo")


if __name__ == '__main__':
    main()
