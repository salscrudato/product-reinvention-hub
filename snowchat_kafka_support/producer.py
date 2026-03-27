"""DEPRECATED shim for legacy producer.

Use the enhanced script:
	python -m kafka_scripts.producer --generate 1
"""
from __future__ import annotations
import runpy

def main():  # pragma: no cover
		print('[deprecated producer] Redirecting to kafka_scripts.producer')
		runpy.run_module('kafka_scripts.producer', run_name='__main__')

if __name__ == '__main__':  # pragma: no cover
		main()
