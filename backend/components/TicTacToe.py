"""TicTacToe GUI Game

Lightweight Tkinter implementation for local play.

Features:
 - 3x3 grid buttons
 - Human vs Human mode (default)
 - Optional simple AI (random or minimax-lite) toggle via environment variable TTT_AI=1
 - Status bar showing turn, winner, draw
 - Restart button
 - Keyboard shortcuts: R to restart, Q to quit

Limitations:
 - Minimax-lite only looks ahead shallowly for speed; uses win/block heuristics.
 - Not integrated with rest of backend (standalone utility).

Run:
 python backend/components/TicTacToe.py
"""
from __future__ import annotations
import os, random, sys
import tkinter as tk
from tkinter import messagebox
from typing import Optional, List

PLAYER_X = 'X'
PLAYER_O = 'O'

class TicTacToeGame:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title('TicTacToe')
        self.ai_enabled = os.getenv('TTT_AI','').lower() in ('1','true','yes','on')
        # Board holds either 'X', 'O', or None for empty squares
        self.board: List[Optional[str]] = [None] * 9  # 0..8
        self.current = PLAYER_X
        self.buttons: List[tk.Button] = []
        self.status_var = tk.StringVar()
        self._build_ui()
        self._update_status()
        self.root.bind('<r>', lambda e: self.restart())
        self.root.bind('<R>', lambda e: self.restart())
        self.root.bind('<q>', lambda e: self.root.destroy())
        self.root.bind('<Q>', lambda e: self.root.destroy())

    def _build_ui(self):
        frame = tk.Frame(self.root)
        frame.pack(padx=10, pady=10)
        for i in range(9):
            btn = tk.Button(frame, text=' ', width=5, height=2, font=('Arial', 20, 'bold'),
                             command=lambda idx=i: self.handle_move(idx))
            r, c = divmod(i, 3)
            btn.grid(row=r, column=c, padx=4, pady=4)
            self.buttons.append(btn)
        bottom = tk.Frame(self.root)
        bottom.pack(fill='x', padx=10, pady=(0,10))
        status_label = tk.Label(bottom, textvariable=self.status_var, font=('Arial', 12))
        status_label.pack(side='left')
        restart_btn = tk.Button(bottom, text='Restart', command=self.restart)
        restart_btn.pack(side='right')
        if self.ai_enabled:
            ai_label = tk.Label(bottom, text='AI: ON', fg='darkgreen')
            ai_label.pack(side='right', padx=10)

    def restart(self):
        self.board = [None]*9  # reset board
        self.current = PLAYER_X
        for b in self.buttons:
            b.configure(text=' ', state='normal')
        self._update_status()

    def handle_move(self, idx: int):
        if self.board[idx] or self._winner():
            return
        self.board[idx] = self.current
        self.buttons[idx].configure(text=self.current)
        winner = self._winner()
        if winner:
            self._finish(f'Winner: {winner}')
            return
        if all(v is not None for v in self.board):
            self._finish('Draw')
            return
        self.current = PLAYER_O if self.current == PLAYER_X else PLAYER_X
        self._update_status()
        if self.ai_enabled and self.current == PLAYER_O:
            self.root.after(200, self._ai_move)

    def _update_status(self):
        if self._winner():
            self.status_var.set(f'Winner: {self._winner()}')
        elif all(v is not None for v in self.board):
            self.status_var.set('Draw')
        else:
            mode = 'vs AI' if self.ai_enabled else 'vs Human'
            self.status_var.set(f'Turn: {self.current} ({mode})')

    def _finish(self, msg: str):
        for b in self.buttons:
            b.configure(state='disabled')
        self.status_var.set(msg)
        # Optional popup
        try:
            messagebox.showinfo('Game Over', msg)
        except Exception:
            pass

    def _winner(self):
        lines = [
            (0,1,2),(3,4,5),(6,7,8),
            (0,3,6),(1,4,7),(2,5,8),
            (0,4,8),(2,4,6)
        ]
        for a,b,c in lines:
            if self.board[a] and self.board[a] == self.board[b] == self.board[c]:
                return self.board[a]
        return None

	# --- Simple AI ---
    def _ai_move(self):
        if self._winner() or all(v is not None for v in self.board):
            return
        move = self._best_move()
        if move is None:
            move = random.choice([i for i,v in enumerate(self.board) if v is None])
        self.handle_move(move)

    def _best_move(self):
        # Try immediate win
        for i in range(9):
            if self.board[i] is None:
                self.board[i] = PLAYER_O
                if self._winner() == PLAYER_O:
                    self.board[i] = None
                    return i
                self.board[i] = None
        # Block opponent immediate win
        for i in range(9):
            if self.board[i] is None:
                self.board[i] = PLAYER_X
                if self._winner() == PLAYER_X:
                    self.board[i] = None
                    return i
                self.board[i] = None
        # Center preference
        if self.board[4] is None:
            return 4
        # Corners preference
        corners = [i for i in [0,2,6,8] if self.board[i] is None]
        if corners:
            return random.choice(corners)
        # Fallback
        empties = [i for i,v in enumerate(self.board) if v is None]
        return random.choice(empties) if empties else None


def main():
    root = tk.Tk()
    TicTacToeGame(root)
    root.mainloop()

if __name__ == '__main__':
    main()
