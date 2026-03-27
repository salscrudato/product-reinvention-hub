from flask import Blueprint, jsonify
from tinydb import TinyDB, Query
from datetime import datetime

analytics_blueprint = Blueprint("feedback_analytics", __name__)
db = TinyDB("state_db.json")
chat_history_table = db.table("chat_history")

@analytics_blueprint.route('/feedback_analytics', methods=['GET'])
def feedback_analytics():
    """
    Returns feedback analytics: Q&A pairs and tool sequences with feedback, and feedback trends over time.
    """
    history = chat_history_table.all()
    feedback_data = []
    feedback_trends = {}
    for msg in history:
        if msg.get('sender') == 'server' and 'liked' in msg:
            feedback_data.append({
                'question': msg.get('text'),
                'answer': msg.get('answer'),
                'function_sequence': msg.get('function_sequence'),
                'liked': msg.get('liked'),
                'timestamp': msg.get('timestamp')
            })
            # Trend by date
            ts = msg.get('timestamp')
            if ts:
                date = ts.split('T')[0] if 'T' in ts else ts[:10]
                if date not in feedback_trends:
                    feedback_trends[date] = {'positive': 0, 'negative': 0}
                if msg['liked']:
                    feedback_trends[date]['positive'] += 1
                else:
                    feedback_trends[date]['negative'] += 1
    return jsonify({
        'feedback_data': feedback_data,
        'feedback_trends': feedback_trends
    })

# To use: import and register analytics_blueprint in your Flask app
