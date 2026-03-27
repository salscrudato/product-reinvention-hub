"""
Fine-Tuning Manager for Azure OpenAI
Manages the complete lifecycle of fine-tuned models.

Features:
- Upload training files to Azure OpenAI
- Create fine-tuning jobs
- Monitor training progress
- List/cancel jobs
- Test fine-tuned models

Usage:
    # Upload training file
    python fine_tuning_manager.py upload --file domain_routing_train.jsonl
    
    # Create fine-tuning job
    python fine_tuning_manager.py create --training-file file-abc123 --model gpt-35-turbo --suffix insurance-routing-v1
    
    # Monitor job
    python fine_tuning_manager.py monitor --job-id ftjob-xyz789
    
    # List all jobs
    python fine_tuning_manager.py list
    
    # Test model
    python fine_tuning_manager.py test --model ft:gpt-35-turbo:org:suffix:id --prompt "What are ACORD requirements?"
"""

import os
import sys
import time
import argparse
import json
from typing import Optional, Dict, List
from pathlib import Path
from datetime import datetime

from openai import AzureOpenAI
from dotenv import load_dotenv

load_dotenv()


class FineTuningManager:
    """Manages Azure OpenAI fine-tuning operations."""
    
    def __init__(self):
        """Initialize Azure OpenAI client."""
        self.client = AzureOpenAI(
            api_key=os.getenv('AZURE_OPENAI_API_KEY'),
            api_version=os.getenv('OPENAI_API_VERSION', '2024-05-01-preview'),
            azure_endpoint=os.getenv('AZURE_OPENAI_ENDPOINT', '')
        )
    
    def upload_file(self, filepath: str, purpose: str = "fine-tune") -> str:
        """
        Upload training file to Azure OpenAI.
        
        Args:
            filepath: Path to JSONL training file
            purpose: File purpose (default: "fine-tune")
            
        Returns:
            file_id: Uploaded file ID
        """
        print(f"Uploading file: {filepath}")
        
        from typing import cast
        from openai.types.file_purpose import FilePurpose
        
        with open(filepath, 'rb') as f:
            response = self.client.files.create(
                file=f,
                purpose=cast(FilePurpose, purpose)
            )
        
        file_id = response.id
        print(f"✓ File uploaded successfully")
        print(f"  File ID: {file_id}")
        print(f"  Filename: {response.filename}")
        print(f"  Size: {response.bytes:,} bytes")
        
        return file_id
    
    def create_job(self, training_file: str, model: str = "gpt-35-turbo", 
                   validation_file: Optional[str] = None, 
                   suffix: Optional[str] = None,
                   hyperparameters: Optional[Dict] = None) -> str:
        """
        Create a fine-tuning job.
        
        Args:
            training_file: Training file ID (from upload_file)
            model: Base model (gpt-35-turbo or gpt-4)
            validation_file: Optional validation file ID
            suffix: Model name suffix (max 40 chars)
            hyperparameters: Training hyperparameters
            
        Returns:
            job_id: Fine-tuning job ID
        """
        print(f"Creating fine-tuning job...")
        print(f"  Base model: {model}")
        print(f"  Training file: {training_file}")
        
        # Default hyperparameters
        if hyperparameters is None:
            hyperparameters = {
                "n_epochs": 3,
                "batch_size": 1,
                "learning_rate_multiplier": 0.1
            }
        
        # Create job
        job_params = {
            "training_file": training_file,
            "model": model,
            "hyperparameters": hyperparameters
        }
        
        if validation_file:
            job_params["validation_file"] = validation_file
        
        if suffix:
            job_params["suffix"] = suffix[:40]  # Max 40 chars
        
        response = self.client.fine_tuning.jobs.create(**job_params)
        
        job_id = response.id
        print(f"✓ Fine-tuning job created")
        print(f"  Job ID: {job_id}")
        print(f"  Status: {response.status}")
        print(f"  Created: {datetime.fromtimestamp(response.created_at)}")
        
        return job_id
    
    def get_job(self, job_id: str) -> Dict:
        """
        Get fine-tuning job details.
        
        Args:
            job_id: Fine-tuning job ID
            
        Returns:
            Job details dictionary
        """
        response = self.client.fine_tuning.jobs.retrieve(job_id)
        return {
            "id": response.id,
            "model": response.model,
            "status": response.status,
            "created_at": datetime.fromtimestamp(response.created_at),
            "finished_at": datetime.fromtimestamp(response.finished_at) if response.finished_at else None,
            "fine_tuned_model": response.fine_tuned_model,
            "training_file": response.training_file,
            "validation_file": response.validation_file,
            "hyperparameters": response.hyperparameters,
            "trained_tokens": response.trained_tokens,
            "error": response.error
        }
    
    def list_jobs(self, limit: int = 20) -> List[Dict]:
        """
        List fine-tuning jobs.
        
        Args:
            limit: Max jobs to return
            
        Returns:
            List of job dictionaries
        """
        response = self.client.fine_tuning.jobs.list(limit=limit)
        
        jobs = []
        for job in response.data:
            jobs.append({
                "id": job.id,
                "model": job.model,
                "status": job.status,
                "created_at": datetime.fromtimestamp(job.created_at),
                "fine_tuned_model": job.fine_tuned_model
            })
        
        return jobs
    
    def cancel_job(self, job_id: str):
        """
        Cancel a fine-tuning job.
        
        Args:
            job_id: Job ID to cancel
        """
        print(f"Cancelling job: {job_id}")
        response = self.client.fine_tuning.jobs.cancel(job_id)
        print(f"✓ Job cancelled")
        print(f"  Status: {response.status}")
    
    def monitor_job(self, job_id: str, interval: int = 60):
        """
        Monitor fine-tuning job until completion.
        
        Args:
            job_id: Job ID to monitor
            interval: Check interval in seconds
        """
        print(f"Monitoring job: {job_id}")
        print(f"(Press Ctrl+C to stop monitoring)\n")
        
        try:
            while True:
                job = self.get_job(job_id)
                
                status = job['status']
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Status: {status}")
                
                if status == 'succeeded':
                    print(f"\n✓ Training complete!")
                    print(f"  Fine-tuned model: {job['fine_tuned_model']}")
                    print(f"  Training tokens: {job['trained_tokens']:,}")
                    print(f"\nTo use this model:")
                    print(f"  1. Update .env: FINE_TUNED_ROUTING_MODEL={job['fine_tuned_model']}")
                    print(f"  2. Restart backend: python app.py")
                    break
                
                elif status == 'failed':
                    print(f"\n✗ Training failed")
                    print(f"  Error: {job['error']}")
                    break
                
                elif status == 'cancelled':
                    print(f"\n✗ Training cancelled")
                    break
                
                else:
                    # Still running
                    print(f"  Elapsed: {(datetime.now() - job['created_at']).total_seconds() / 60:.1f} minutes")
                    time.sleep(interval)
        
        except KeyboardInterrupt:
            print("\nMonitoring stopped (job still running)")
    
    def list_files(self, purpose: Optional[str] = None) -> List[Dict]:
        """
        List uploaded files.
        
        Args:
            purpose: Filter by purpose (e.g., "fine-tune")
            
        Returns:
            List of file dictionaries
        """
        response = self.client.files.list(purpose=purpose if purpose else None)  # type: ignore[arg-type]
        
        files = []
        for file in response.data:
            files.append({
                "id": file.id,
                "filename": file.filename,
                "purpose": file.purpose,
                "bytes": file.bytes,
                "created_at": datetime.fromtimestamp(file.created_at)
            })
        
        return files
    
    def delete_file(self, file_id: str):
        """
        Delete an uploaded file.
        
        Args:
            file_id: File ID to delete
        """
        print(f"Deleting file: {file_id}")
        self.client.files.delete(file_id)
        print(f"✓ File deleted")
    
    def test_model(self, model: str, prompt: str, system_prompt: Optional[str] = None) -> str:
        """
        Test a fine-tuned model.
        
        Args:
            model: Fine-tuned model name
            prompt: Test prompt
            system_prompt: Optional system prompt
            
        Returns:
            Model response
        """
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        print(f"Testing model: {model}")
        print(f"Prompt: {prompt}\n")
        
        response = self.client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.1,
            max_tokens=500
        )
        
        answer = response.choices[0].message.content or ""
        print(f"Response: {answer}\n")
        print(f"Tokens used: {response.usage.total_tokens}")
        
        return answer


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(description='Fine-Tuning Manager for Azure OpenAI')
    subparsers = parser.add_subparsers(dest='command', help='Command to run')
    
    # Upload command
    upload_parser = subparsers.add_parser('upload', help='Upload training file')
    upload_parser.add_argument('--file', required=True, help='Path to JSONL file')
    upload_parser.add_argument('--purpose', default='fine-tune', help='File purpose')
    
    # Create command
    create_parser = subparsers.add_parser('create', help='Create fine-tuning job')
    create_parser.add_argument('--training-file', required=True, help='Training file ID')
    create_parser.add_argument('--validation-file', help='Validation file ID')
    create_parser.add_argument('--model', default='gpt-35-turbo', help='Base model')
    create_parser.add_argument('--suffix', help='Model name suffix')
    create_parser.add_argument('--epochs', type=int, default=3, help='Training epochs')
    create_parser.add_argument('--batch-size', type=int, default=1, help='Batch size')
    create_parser.add_argument('--learning-rate', type=float, default=0.1, help='Learning rate multiplier')
    
    # Monitor command
    monitor_parser = subparsers.add_parser('monitor', help='Monitor job progress')
    monitor_parser.add_argument('--job-id', required=True, help='Job ID to monitor')
    monitor_parser.add_argument('--interval', type=int, default=60, help='Check interval (seconds)')
    
    # List jobs command
    list_parser = subparsers.add_parser('list', help='List fine-tuning jobs')
    list_parser.add_argument('--limit', type=int, default=20, help='Max jobs to list')
    
    # Get job command
    get_parser = subparsers.add_parser('get', help='Get job details')
    get_parser.add_argument('--job-id', required=True, help='Job ID')
    
    # Cancel command
    cancel_parser = subparsers.add_parser('cancel', help='Cancel job')
    cancel_parser.add_argument('--job-id', required=True, help='Job ID to cancel')
    
    # List files command
    files_parser = subparsers.add_parser('files', help='List uploaded files')
    files_parser.add_argument('--purpose', help='Filter by purpose')
    
    # Delete file command
    delete_parser = subparsers.add_parser('delete-file', help='Delete file')
    delete_parser.add_argument('--file-id', required=True, help='File ID to delete')
    
    # Test command
    test_parser = subparsers.add_parser('test', help='Test fine-tuned model')
    test_parser.add_argument('--model', required=True, help='Fine-tuned model name')
    test_parser.add_argument('--prompt', required=True, help='Test prompt')
    test_parser.add_argument('--system-prompt', help='System prompt')
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        sys.exit(1)
    
    manager = FineTuningManager()
    
    try:
        if args.command == 'upload':
            file_id = manager.upload_file(args.file, args.purpose)
            print(f"\nNext: Create job with this file ID:")
            print(f"  python fine_tuning_manager.py create --training-file {file_id} --model gpt-35-turbo")
        
        elif args.command == 'create':
            hyperparameters = {
                "n_epochs": args.epochs,
                "batch_size": args.batch_size,
                "learning_rate_multiplier": args.learning_rate
            }
            job_id = manager.create_job(
                training_file=args.training_file,
                model=args.model,
                validation_file=args.validation_file,
                suffix=args.suffix,
                hyperparameters=hyperparameters
            )
            print(f"\nNext: Monitor training progress:")
            print(f"  python fine_tuning_manager.py monitor --job-id {job_id}")
        
        elif args.command == 'monitor':
            manager.monitor_job(args.job_id, args.interval)
        
        elif args.command == 'list':
            jobs = manager.list_jobs(args.limit)
            print(f"\nFine-tuning jobs ({len(jobs)}):\n")
            for job in jobs:
                print(f"  {job['id']}")
                print(f"    Model: {job['model']}")
                print(f"    Status: {job['status']}")
                print(f"    Created: {job['created_at']}")
                if job['fine_tuned_model']:
                    print(f"    Fine-tuned: {job['fine_tuned_model']}")
                print()
        
        elif args.command == 'get':
            job = manager.get_job(args.job_id)
            print(f"\nJob Details:\n")
            for key, value in job.items():
                if value is not None:
                    print(f"  {key}: {value}")
        
        elif args.command == 'cancel':
            manager.cancel_job(args.job_id)
        
        elif args.command == 'files':
            files = manager.list_files(args.purpose)
            print(f"\nUploaded files ({len(files)}):\n")
            for file in files:
                print(f"  {file['id']}")
                print(f"    Filename: {file['filename']}")
                print(f"    Purpose: {file['purpose']}")
                print(f"    Size: {file['bytes']:,} bytes")
                print(f"    Created: {file['created_at']}")
                print()
        
        elif args.command == 'delete-file':
            manager.delete_file(args.file_id)
        
        elif args.command == 'test':
            manager.test_model(args.model, args.prompt, args.system_prompt)
    
    except Exception as e:
        print(f"\n✗ Error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
