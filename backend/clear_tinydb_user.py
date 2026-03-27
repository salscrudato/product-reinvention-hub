from tinydb import TinyDB, Query
import argparse

def clear_user_data(db_path, username):
    db = TinyDB(db_path)
    User = Query()
    # Clear from chat_history table
    chat_removed = db.table("chat_history").remove(User.username == username)
    # Clear from function_sequences table (user_id or username depending on your schema)
    seq_removed = db.table("function_sequences").remove((User.user_id == username) | (User.username == username))
    print(f"Cleared {len(chat_removed)} chat_history and {len(seq_removed)} function_sequences records for user: {username}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Clear TinyDB records for a specific user.")
    parser.add_argument("--db", type=str, default="state_db.json", help="Path to TinyDB JSON file")
    parser.add_argument("--user", type=str, required=True, help="Username to clear records for")
    args = parser.parse_args()
    clear_user_data(args.db, args.user)
