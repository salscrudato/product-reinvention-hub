"""
Quick test runner for Swagger mapping implementation.
Runs tests and displays results with color-coded output.
"""
import subprocess
import sys
from pathlib import Path

def main():
    """Run test suite with formatted output."""
    
    # Ensure we're in the backend directory
    backend_dir = Path(__file__).parent
    test_file = backend_dir / "tests" / "test_swagger_mapping.py"
    
    if not test_file.exists():
        print(f"❌ Test file not found: {test_file}")
        return 1
    
    print("=" * 70)
    print("🧪 SWAGGER MAPPING TEST SUITE")
    print("=" * 70)
    print(f"\n📁 Running tests from: {test_file}\n")
    
    # Run pytest with verbose output
    cmd = [
        sys.executable,
        "-m",
        "pytest",
        str(test_file),
        "-v",
        "--tb=short",
        "--color=yes",
        "-ra"  # Show summary of all test outcomes
    ]
    
    # Add coverage if available
    try:
        import pytest_cov
        cmd.extend([
            "--cov=components.mapping_agents",
            "--cov-report=term-missing:skip-covered"
        ])
        print("📊 Coverage reporting enabled\n")
    except ImportError:
        print("ℹ️  Install pytest-cov for coverage: pip install pytest-cov\n")
    
    try:
        result = subprocess.run(cmd, cwd=backend_dir)
        
        print("\n" + "=" * 70)
        if result.returncode == 0:
            print("✅ ALL TESTS PASSED!")
        else:
            print("❌ SOME TESTS FAILED")
        print("=" * 70 + "\n")
        
        return result.returncode
    
    except FileNotFoundError:
        print("❌ pytest not found. Install with: pip install pytest pytest-cov")
        return 1
    except KeyboardInterrupt:
        print("\n⚠️  Tests interrupted by user")
        return 130


if __name__ == "__main__":
    sys.exit(main())
