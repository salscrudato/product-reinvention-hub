"""TinyDB Cleanup Script

Purpose: Reduce database size by retaining only recent data.
- Chat history: Keep last 5 conversations per user
- Token usage: Keep last 10 entries

Usage:
    python cleanup_tinydb.py                    # Dry run (preview only)
    python cleanup_tinydb.py --execute          # Actually delete data
    python cleanup_tinydb.py --execute --backup # Backup before deletion

Note: This improves disk space, NOT request performance.
For performance, use the singleton pattern (already implemented).

Tables managed:
- chat_history: User-AI conversation history
- token_usage: OpenAI token consumption metrics

Tables preserved (user preferences):
- function_sequences: User feedback on tool sequences
- user_session_context: Session state and preferences
"""

import os
import sys
import json
import shutil
from datetime import datetime
from collections import defaultdict
from tinydb import TinyDB, Query

# Configuration
CHAT_HISTORY_KEEP_LAST = 5  # Keep last N conversations per user
TOKEN_USAGE_KEEP_LAST = 10  # Keep last N token usage entries
STATE_DB_PATH = 'state_db.json'
BACKUP_SUFFIX = f'_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}'

# Note: function_sequences and user_session_context are kept (user preferences)


def backup_database(db_path: str) -> str:
    """Create timestamped backup of database file."""
    backup_path = db_path + BACKUP_SUFFIX
    shutil.copy2(db_path, backup_path)
    print(f"✅ Backup created: {backup_path}")
    return backup_path


def analyze_chat_history(db: TinyDB) -> dict:
    """Analyze chat history and identify records to delete."""
    chat_table = db.table('chat_history')
    all_records = chat_table.all()
    
    # Group by username
    by_user = defaultdict(list)
    for record in all_records:
        username = record.get('username', 'unknown')
        timestamp = record.get('timestamp', '')
        by_user[username].append({
            'doc_id': record.doc_id,
            'timestamp': timestamp,
            'sender': record.get('sender'),
            'text_preview': str(record.get('text', ''))[:50]
        })
    
    # Sort by timestamp (newest first) and mark old ones for deletion
    to_delete = []
    stats = {
        'total_records': len(all_records),
        'users': len(by_user),
        'to_delete': 0,
        'to_keep': 0,
        'by_user': {}
    }
    
    for username, records in by_user.items():
        # Sort by timestamp descending (newest first)
        records.sort(key=lambda x: x['timestamp'], reverse=True)
        
        keep_count = min(CHAT_HISTORY_KEEP_LAST, len(records))
        delete_count = max(0, len(records) - CHAT_HISTORY_KEEP_LAST)
        
        # Mark old records for deletion
        old_records = records[CHAT_HISTORY_KEEP_LAST:]
        to_delete.extend([r['doc_id'] for r in old_records])
        
        stats['by_user'][username] = {
            'total': len(records),
            'keep': keep_count,
            'delete': delete_count
        }
        stats['to_delete'] += delete_count
        stats['to_keep'] += keep_count
    
    return {'to_delete': to_delete, 'stats': stats}


def analyze_token_usage(db: TinyDB) -> dict:
    """Analyze token usage and identify records to delete."""
    usage_table = db.table('token_usage')
    all_records = usage_table.all()
    
    # Sort by timestamp (newest first)
    sorted_records = sorted(
        all_records,
        key=lambda x: x.get('timestamp', ''),
        reverse=True
    )
    
    keep_count = min(TOKEN_USAGE_KEEP_LAST, len(sorted_records))
    delete_count = max(0, len(sorted_records) - TOKEN_USAGE_KEEP_LAST)
    
    # Mark old records for deletion
    old_records = sorted_records[TOKEN_USAGE_KEEP_LAST:]
    to_delete = [r.doc_id for r in old_records]
    
    stats = {
        'total_records': len(all_records),
        'to_keep': keep_count,
        'to_delete': delete_count
    }
    
    return {'to_delete': to_delete, 'stats': stats}


def print_analysis(chat_analysis: dict, usage_analysis: dict):
    """Print cleanup analysis summary."""
    print("\n" + "="*70)
    print("  TINYDB CLEANUP ANALYSIS")
    print("="*70)
    
    print("\n📊 CHAT HISTORY:")
    cs = chat_analysis['stats']
    print(f"   Total records: {cs['total_records']}")
    print(f"   Users: {cs['users']}")
    print(f"   Policy: Keep last {CHAT_HISTORY_KEEP_LAST} conversations per user")
    print(f"   ✅ To keep: {cs['to_keep']}")
    print(f"   ❌ To delete: {cs['to_delete']}")
    
    if cs['by_user']:
        print("\n   Per-user breakdown:")
        for username, stats in sorted(cs['by_user'].items()):
            print(f"      {username}: {stats['total']} total → "
                  f"keep {stats['keep']}, delete {stats['delete']}")
    
    print("\n📊 TOKEN USAGE:")
    us = usage_analysis['stats']
    print(f"   Total records: {us['total_records']}")
    print(f"   Policy: Keep last {TOKEN_USAGE_KEEP_LAST} entries")
    print(f"   ✅ To keep: {us['to_keep']}")
    print(f"   ❌ To delete: {us['to_delete']}")
    
    # Calculate disk space impact (rough estimate)
    total_deleted = cs['to_delete'] + us['to_delete']
    avg_record_size = 2048  # bytes (rough average)
    estimated_savings_mb = (total_deleted * avg_record_size) / (1024 * 1024)
    
    print(f"\n💾 ESTIMATED DISK SAVINGS: ~{estimated_savings_mb:.2f} MB")
    print("\n⚠️  WARNING: This cleanup improves disk space, NOT request latency.")
    print("   For performance, restart backend to activate singleton pattern.")
    print("="*70 + "\n")


def execute_cleanup(db: TinyDB, chat_analysis: dict, usage_analysis: dict):
    """Execute the cleanup (actually delete records)."""
    print("\n🔧 EXECUTING CLEANUP...")
    
    # Delete chat history records
    if chat_analysis['to_delete']:
        chat_table = db.table('chat_history')
        for doc_id in chat_analysis['to_delete']:
            chat_table.remove(doc_ids=[doc_id])
        print(f"✅ Deleted {len(chat_analysis['to_delete'])} chat history records")
    else:
        print("   No chat history records to delete")
    
    # Delete token usage records
    if usage_analysis['to_delete']:
        usage_table = db.table('token_usage')
        for doc_id in usage_analysis['to_delete']:
            usage_table.remove(doc_ids=[doc_id])
        print(f"✅ Deleted {len(usage_analysis['to_delete'])} token usage records")
    else:
        print("   No token usage records to delete")
    
    print("\n✅ CLEANUP COMPLETE!\n")


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Cleanup TinyDB by retaining only recent data'
    )
    parser.add_argument(
        '--execute',
        action='store_true',
        help='Actually delete data (default is dry-run preview only)'
    )
    parser.add_argument(
        '--backup',
        action='store_true',
        help='Create backup before deletion (only with --execute)'
    )
    parser.add_argument(
        '--db-path',
        default=STATE_DB_PATH,
        help='Path to state_db.json file'
    )
    
    args = parser.parse_args()
    
    # Check if database exists
    if not os.path.exists(args.db_path):
        print(f"❌ Database not found: {args.db_path}")
        print("   Run this script from backend/ directory")
        sys.exit(1)
    
    # Open database
    db = TinyDB(args.db_path)
    
    try:
        # Analyze what would be deleted
        print("\n🔍 Analyzing database...")
        chat_analysis = analyze_chat_history(db)
        usage_analysis = analyze_token_usage(db)
        
        # Print analysis
        print_analysis(chat_analysis, usage_analysis)
        
        # Execute if requested
        if args.execute:
            # Create backup if requested
            if args.backup:
                backup_database(args.db_path)
            
            # Confirm before deletion
            total_to_delete = (
                chat_analysis['stats']['to_delete'] + 
                usage_analysis['stats']['to_delete']
            )
            
            if total_to_delete == 0:
                print("✅ No records to delete. Database is already clean!")
                return
            
            confirm = input(f"\n⚠️  Delete {total_to_delete} records? [yes/NO]: ")
            if confirm.lower() != 'yes':
                print("❌ Cleanup cancelled")
                return
            
            execute_cleanup(db, chat_analysis, usage_analysis)
            
            # Show final size
            final_size_mb = os.path.getsize(args.db_path) / (1024 * 1024)
            print(f"📊 Final database size: {final_size_mb:.2f} MB")
            
        else:
            print("ℹ️  DRY RUN MODE - No data was deleted")
            print("   Run with --execute to actually delete data")
            print("   Run with --execute --backup to create backup first")
            print(f"\n   Example: python {os.path.basename(__file__)} --execute --backup\n")
    
    finally:
        db.close()


if __name__ == '__main__':
    main()
