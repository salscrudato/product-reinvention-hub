"""
Automated Retraining Pipeline for Intent Classifier

This script orchestrates the complete retraining workflow:
1. Check if retraining is needed (>=50 new examples since last training)
2. Extract training data from logs
3. Train new model with validation
4. Compare accuracy: only save if >= current model
5. Backup old model (keep last 3 versions)
6. Send notification (optional: email/Slack)
7. Clean up old training data files

Usage:
    python retrain_pipeline.py [--force] [--min-new-examples 50] [--notify]
"""

import sys
import json
import logging
import shutil
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.extract_training_data_from_logs import LogParser
from scripts.train_intent_classifier import main as train_model
from components.intent_classifier_ml import MLIntentClassifier

# Configure logging (UTF-8 for file, console without emojis)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('retrain_pipeline.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('retrain_pipeline')


class RetrainPipeline:
    """Manages automated model retraining workflow"""
    
    def __init__(self, backend_dir: Path):
        self.backend_dir = backend_dir
        self.models_dir = backend_dir / 'models'
        self.scripts_dir = backend_dir / 'scripts'
        self.log_file = backend_dir / 'agentic_orchestrator_auto.log'
        
        # Configuration
        self.min_new_examples = 50  # Minimum new examples to trigger retraining
        self.max_model_backups = 3  # Keep last 3 model versions
        self.min_accuracy_improvement = 0.0  # Deploy if accuracy >= current (0% improvement threshold)
    
    def check_retraining_needed(self, force: bool = False) -> Tuple[bool, str]:
        """
        Check if retraining is needed based on new examples count
        
        Returns:
            (should_retrain, reason)
        """
        if force:
            return True, "Forced retraining requested"
        
        # Check if training_info.json exists
        training_info_path = self.models_dir / 'training_info.json'
        if not training_info_path.exists():
            return True, "No previous training found"
        
        # Load previous training info
        try:
            with open(training_info_path, 'r') as f:
                training_info = json.load(f)
            
            last_train_examples = training_info.get('training_examples', 0)
            last_train_date = training_info.get('train_date')
            
            logger.info(f"Previous training: {last_train_examples} examples on {last_train_date}")
        except Exception as e:
            logger.warning(f"Could not read training_info.json: {e}")
            return True, "Cannot read previous training info"
        
        # Extract current training data count
        try:
            parser = LogParser(str(self.log_file))
            parser.parse_log_file()
            current_data = parser.build_training_dataset()
            current_count = len([ex for ex in current_data if ex['intent'] != 'unknown'])
            
            new_examples = current_count - last_train_examples
            
            logger.info(f"Current examples: {current_count}, New examples: {new_examples}")
            
            if new_examples >= self.min_new_examples:
                return True, f"Found {new_examples} new examples (threshold: {self.min_new_examples})"
            else:
                return False, f"Only {new_examples} new examples (threshold: {self.min_new_examples})"
        
        except Exception as e:
            logger.error(f"Error extracting training data: {e}")
            return False, f"Error checking training data: {e}"
    
    def backup_current_model(self) -> bool:
        """
        Backup current model files with timestamp
        
        Returns:
            True if backup successful, False otherwise
        """
        try:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            backup_dir = self.models_dir / f'backup_{timestamp}'
            backup_dir.mkdir(exist_ok=True)
            
            # Files to backup
            model_files = [
                'intent_classifier_model.pkl',
                'intent_classifier_vectorizer.pkl',
                'intent_classifier_labels.pkl',
                'intent_classifier_metadata.json',
                'training_info.json'
            ]
            
            backed_up = 0
            for filename in model_files:
                src = self.models_dir / filename
                if src.exists():
                    dst = backup_dir / filename
                    shutil.copy2(src, dst)
                    backed_up += 1
            
            logger.info(f"[SUCCESS] Backed up {backed_up} model files to {backup_dir}")
            
            # Clean up old backups (keep only last N)
            self._cleanup_old_backups()
            
            return True
        
        except Exception as e:
            logger.error(f"[FAILED] Backup failed: {e}")
            return False
    
    def _cleanup_old_backups(self):
        """Remove old backup directories, keeping only the most recent N"""
        try:
            backup_dirs = sorted(
                [d for d in self.models_dir.iterdir() if d.is_dir() and d.name.startswith('backup_')],
                key=lambda x: x.name,
                reverse=True
            )
            
            if len(backup_dirs) > self.max_model_backups:
                for old_backup in backup_dirs[self.max_model_backups:]:
                    shutil.rmtree(old_backup)
                    logger.info(f"Removed old backup: {old_backup.name}")
        
        except Exception as e:
            logger.warning(f"Error cleaning up old backups: {e}")
    
    def train_new_model(self) -> Tuple[bool, Optional[Dict]]:
        """
        Train new model and return training results
        
        Returns:
            (success, training_results)
        """
        try:
            logger.info("Starting model training...")
            
            # Run training script (call without arguments, uses CLI defaults)
            # Note: train_model() returns None, so we need to read results from files
            import subprocess
            import sys
            result = subprocess.run(
                [sys.executable, str(self.scripts_dir / 'train_intent_classifier.py'), '--min-examples', '2'],
                cwd=str(self.backend_dir),
                capture_output=True,
                text=True
            )
            
            if result.returncode != 0:
                logger.error(f"Training script failed: {result.stderr}")
                return False, None
            
            # Read training results
            training_info_path = self.models_dir / 'training_info.json'
            if not training_info_path.exists():
                logger.error("Training completed but training_info.json not found")
                return False, None
            
            with open(training_info_path, 'r') as f:
                training_info = json.load(f)
            
            metadata_path = self.models_dir / 'intent_classifier_metadata.json'
            if metadata_path.exists():
                with open(metadata_path, 'r') as f:
                    metadata = json.load(f)
                    training_info['metadata'] = metadata
            
            logger.info(f"[SUCCESS] Training completed: {training_info.get('test_accuracy', 0)*100:.1f}% accuracy")
            return True, training_info
        
        except Exception as e:
            logger.error(f"[FAILED] Training failed: {e}")
            return False, None
    
    def validate_new_model(self, training_info: Dict) -> Tuple[bool, str]:
        """
        Validate new model against current model
        
        Returns:
            (should_deploy, reason)
        """
        try:
            # Get new model accuracy
            new_accuracy = training_info.get('test_accuracy', 0.0)
            
            # Check if we have a previous model to compare
            backup_dirs = sorted(
                [d for d in self.models_dir.iterdir() if d.is_dir() and d.name.startswith('backup_')],
                key=lambda x: x.name,
                reverse=True
            )
            
            if not backup_dirs:
                return True, f"First model deployment: {new_accuracy*100:.1f}% accuracy"
            
            # Read previous model's training info
            prev_training_info_path = backup_dirs[0] / 'training_info.json'
            if not prev_training_info_path.exists():
                return True, f"No previous training info to compare, deploying new model: {new_accuracy*100:.1f}%"
            
            with open(prev_training_info_path, 'r') as f:
                prev_training_info = json.load(f)
            
            prev_accuracy = prev_training_info.get('test_accuracy', 0.0)
            accuracy_delta = new_accuracy - prev_accuracy
            
            logger.info(f"Model comparison: Previous={prev_accuracy*100:.1f}%, New={new_accuracy*100:.1f}%, Delta={accuracy_delta*100:+.1f}%")
            
            if accuracy_delta >= self.min_accuracy_improvement:
                return True, f"Model improved: {prev_accuracy*100:.1f}% → {new_accuracy*100:.1f}% ({accuracy_delta*100:+.1f}%)"
            else:
                return False, f"Model did not improve: {prev_accuracy*100:.1f}% → {new_accuracy*100:.1f}% ({accuracy_delta*100:+.1f}%)"
        
        except Exception as e:
            logger.error(f"Validation error: {e}")
            return False, f"Validation error: {e}"
    
    def rollback_model(self):
        """Restore previous model from most recent backup"""
        try:
            backup_dirs = sorted(
                [d for d in self.models_dir.iterdir() if d.is_dir() and d.name.startswith('backup_')],
                key=lambda x: x.name,
                reverse=True
            )
            
            if not backup_dirs:
                logger.error("No backups available for rollback")
                return False
            
            latest_backup = backup_dirs[0]
            logger.info(f"Rolling back to {latest_backup.name}")
            
            # Restore files from backup
            model_files = [
                'intent_classifier_model.pkl',
                'intent_classifier_vectorizer.pkl',
                'intent_classifier_labels.pkl',
                'intent_classifier_metadata.json',
                'training_info.json'
            ]
            
            for filename in model_files:
                src = latest_backup / filename
                if src.exists():
                    dst = self.models_dir / filename
                    shutil.copy2(src, dst)
            
            logger.info("[SUCCESS] Rollback completed")
            return True
        
        except Exception as e:
            logger.error(f"[FAILED] Rollback failed: {e}")
            return False
    
    def send_notification(self, success: bool, message: str, training_info: Optional[Dict] = None):
        """
        Send notification about retraining result
        
        Args:
            success: Whether retraining was successful
            message: Summary message
            training_info: Training results (optional)
        """
        # Prepare notification content
        status = "[SUCCESS]" if success else "[FAILED]"
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        notification_body = f"""
SnowChat ML Model Retraining Report
{status}
Timestamp: {timestamp}

{message}
"""
        
        if training_info:
            notification_body += f"""
Training Details:
- Test Accuracy: {training_info.get('test_accuracy', 0)*100:.1f}%
- Training Examples: {training_info.get('training_examples', 0)}
- Intents: {len(training_info.get('metadata', {}).get('intents', []))}
"""
        
        # Log notification
        logger.info(f"NOTIFICATION:\n{notification_body}")
        
        # TODO: Add email/Slack integration
        # Example: send_slack_message(channel='#ml-notifications', text=notification_body)
        # Example: send_email(to='devops@company.com', subject=f'ML Retraining {status}', body=notification_body)
    
    def run(self, force: bool = False, notify: bool = True) -> bool:
        """
        Execute complete retraining pipeline
        
        Args:
            force: Force retraining even if not enough new examples
            notify: Send notification on completion
        
        Returns:
            True if retraining successful and deployed, False otherwise
        """
        logger.info("=" * 80)
        logger.info("Starting Automated Retraining Pipeline")
        logger.info("=" * 80)
        
        # Step 1: Check if retraining is needed
        should_retrain, reason = self.check_retraining_needed(force=force)
        logger.info(f"Retraining check: {reason}")
        
        if not should_retrain:
            logger.info("[SKIP] Skipping retraining")
            if notify:
                self.send_notification(True, f"Retraining skipped: {reason}")
            return True
        
        # Step 2: Backup current model
        logger.info("\n[BACKUP] Backing up current model...")
        if not self.backup_current_model():
            logger.error("Backup failed, aborting retraining")
            if notify:
                self.send_notification(False, "Backup failed, retraining aborted")
            return False
        
        # Step 3: Train new model
        logger.info("\n[TRAIN] Training new model...")
        success, training_info = self.train_new_model()
        
        if not success or training_info is None:
            logger.error("Training failed, rolling back...")
            self.rollback_model()
            if notify:
                self.send_notification(False, "Training failed, rolled back to previous model")
            return False
        
        # Step 4: Validate new model
        logger.info("\n[VALIDATE] Validating new model...")
        should_deploy, validation_reason = self.validate_new_model(training_info)
        logger.info(f"Validation result: {validation_reason}")
        
        if not should_deploy:
            logger.warning("New model did not meet deployment criteria, rolling back...")
            self.rollback_model()
            if notify:
                self.send_notification(False, f"Model validation failed: {validation_reason}", training_info)
            return False
        
        # Step 5: Success!
        logger.info("\n[COMPLETE] Retraining pipeline completed successfully!")
        if notify:
            self.send_notification(True, f"Model deployed: {validation_reason}", training_info)
        
        return True


def main():
    """Main entry point for retraining pipeline"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Automated ML Model Retraining Pipeline')
    parser.add_argument('--force', action='store_true', help='Force retraining regardless of new examples count')
    parser.add_argument('--min-new-examples', type=int, default=50, help='Minimum new examples to trigger retraining (default: 50)')
    parser.add_argument('--notify', action='store_true', help='Send notification on completion')
    
    args = parser.parse_args()
    
    # Initialize pipeline
    backend_dir = Path(__file__).parent.parent
    pipeline = RetrainPipeline(backend_dir)
    pipeline.min_new_examples = args.min_new_examples
    
    # Run pipeline
    success = pipeline.run(force=args.force, notify=args.notify)
    
    # Exit with appropriate code
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
