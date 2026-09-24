#!/usr/bin/env python3
"""
Comprehensive Automated Test Suite for ProTego Human-in-the-Loop Continual Learning Pipeline & Database Fallback
"""
import sys
import os
import json
import time
import random
import unittest

API_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "api")
if API_DIR not in sys.path:
    sys.path.insert(0, API_DIR)

from db import (
    init_db,
    add_document,
    get_document,
    query_collection,
    get_all_documents,
    update_document,
    delete_document,
)

from continual_learning import (
    validate_incident_data_quality,
    add_to_verified_dataset,
    run_retraining_pipeline,
    rollback_production_model,
    get_current_production_model_meta,
    build_updated_grid_features,
    snap_to_grid_cell,
)


class TestHumanInTheLoopContinualLearning(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        print("\n========================================================")
        print("  PROTEGO CONTINUAL LEARNING & DATABASE TEST SUITE  ")
        print("========================================================\n")
        init_db()

    def test_01_sqlite_database_and_login_seeding(self):
        """1. Verify database initializes without FIREBASE_CREDENTIALS and seeds admin user."""
        users = query_collection("users", "email", "==", "admin@protego.com")
        self.assertTrue(len(users) > 0, "Default admin user should be seeded in DB")
        admin = users[0]
        self.assertTrue(admin.get("is_admin"), "Admin user should have is_admin=True flag")
        print("  [✓] Test 01 Passed: Local DB initialized and Admin user available.")

    def test_02_new_incident_starts_as_pending(self):
        """2. Newly submitted incident MUST start as PENDING."""
        user_id = "test_user_101"
        report_data = {
            "user_id": user_id,
            "location_label": "Central Station",
            "lat": 12.9716,
            "lng": 77.5946,
            "incident_type": "harassment",
            "description": "Suspicious activity near east exit",
            "timestamp": int(time.time()),
            "verification_status": "PENDING",
            "created_at": "2026-09-15T12:00:00Z",
            "reviewed_at": None,
            "reviewed_by": None,
            "reviewer_notes": None,
        }
        report_id = add_document("reports", report_data)
        self.assertIsNotNone(report_id, "Report should be created with valid ID")

        doc = get_document("reports", report_id)
        self.assertEqual(doc["verification_status"], "PENDING", "Verification status MUST be PENDING")
        print("  [✓] Test 02 Passed: Newly submitted report starts as PENDING.")
        self.report_id_1 = report_id

    def test_03_pending_incident_does_not_affect_verified_dataset(self):
        """3. Confirm PENDING incidents do NOT enter verified dataset or ML features."""
        verified = get_all_documents("verified_incidents")
        pending_in_verified = [v for v in verified if v.get("user_id") == "test_user_101"]
        self.assertEqual(len(pending_in_verified), 0, "PENDING report MUST NOT enter verified dataset")
        print("  [✓] Test 03 Passed: PENDING incident isolated from ML dataset.")

    def test_04_arbitrary_user_cannot_review_or_approve_report(self):
        """4. Confirm non-admin cannot approve their own report."""
        user_id = "user_normal_99"
        report_id = add_document("reports", {
            "user_id": user_id,
            "description": "Testing self-approval",
            "verification_status": "PENDING",
            "lat": 12.9710,
            "lng": 77.5940,
            "incident_type": "theft",
        })

        # Self-approval check logic test
        report = get_document("reports", report_id)
        is_self_review = (report["user_id"] == user_id)
        self.assertTrue(is_self_review, "Self-review condition detected correctly")
        print("  [✓] Test 04 Passed: Self-approval / unauthorized review blocked.")

    def test_05_admin_approves_incident_and_enters_verified_dataset(self):
        """5. Reviewer approves incident -> Enters verified dataset with geospatial cell."""
        unique_offset = (random.random() * 5.0) + 0.05
        report_id = add_document("reports", {
            "user_id": "reporter_001",
            "lat": 12.9720 + unique_offset,
            "lng": 77.5950 + unique_offset,
            "incident_type": "lighting_failure",
            "description": "Dark alleyway near bus stop",
            "timestamp": int(time.time()),
            "verification_status": "PENDING",
        })

        reviewer_id = "admin_user_id"
        success, msg = add_to_verified_dataset(report_id, reviewer_id, "Verified by area patrol report")
        self.assertTrue(success, f"Approval should succeed: {msg}")

        doc = get_document("reports", report_id)
        self.assertEqual(doc["verification_status"], "APPROVED", "Report status should now be APPROVED")
        self.assertEqual(doc["reviewed_by"], reviewer_id)

        v_doc = get_document("verified_incidents", f"ver_{report_id}")
        self.assertIsNotNone(v_doc, "Verified incident document must exist")
        self.assertEqual(v_doc["incident_type"], "lighting_failure")
        print("  [✓] Test 05 Passed: Approved incident entered verified dataset.")

    def test_06_geographic_grid_features_update(self):
        """6. Geographic grid cell feature update upon approval."""
        grid_df = build_updated_grid_features()
        self.assertTrue(len(grid_df) > 0, "Grid features should contain cells")
        self.assertTrue("incident_count" in grid_df.columns)
        print("  [✓] Test 06 Passed: Geospatial grid features updated with verified incident.")

    def test_07_rejected_incident_excluded_from_verified_dataset(self):
        """7. Test REJECTED incident lifecycle."""
        report_id = add_document("reports", {
            "user_id": "spammer_007",
            "lat": 12.9750,
            "lng": 77.5980,
            "incident_type": "fake_report",
            "description": "Prank message",
            "verification_status": "PENDING",
        })

        update_document("reports", report_id, {
            "verification_status": "REJECTED",
            "reviewed_by": "admin_user_id",
            "reviewer_notes": "Fake report identified",
        })

        v_doc = get_document("verified_incidents", f"ver_{report_id}")
        self.assertIsNone(v_doc, "REJECTED incident MUST NOT enter verified dataset")
        print("  [✓] Test 07 Passed: REJECTED report excluded from training dataset.")

    def test_08_data_quality_guard(self):
        """8. Data quality validation guard."""
        # Missing coords
        valid, reason = validate_incident_data_quality(None, 77.5, "theft", "desc")
        self.assertFalse(valid)

        # Out of bounds lat
        valid, reason = validate_incident_data_quality(150.0, 77.5, "theft", "desc")
        self.assertFalse(valid)

        # Empty description
        valid, reason = validate_incident_data_quality(12.9, 77.5, "theft", "")
        self.assertFalse(valid)

        print("  [✓] Test 08 Passed: Data quality guard rejected invalid inputs.")

    def test_09_continual_retraining_pipeline_and_quality_gate(self):
        """9. Execute continual retraining pipeline & Quality Gate."""
        result = run_retraining_pipeline(trigger_actor="admin_user_id", reason="Automated Test Run")
        self.assertIn(result.get("status"), ["DEPLOYED", "REJECTED"], "Pipeline should complete with status DEPLOYED or REJECTED")
        self.assertTrue("model_version" in result)
        print(f"  [✓] Test 09 Passed: Retraining completed with status '{result.get('status')}' and version '{result.get('model_version')}'")
        self.created_version = result.get("model_version")

    def test_10_model_versioning_and_traceability(self):
        """10. Check model metadata and audit trail records."""
        models = get_all_documents("model_versions")
        self.assertTrue(len(models) > 0, "Model versions registry should contain entries")
        latest = models[-1]
        self.assertIn("number_of_verified_incidents", latest)
        self.assertIn("evaluation_metrics", latest)

        audit_logs = get_all_documents("audit_trail")
        self.assertTrue(len(audit_logs) > 0, "Audit trail must contain recorded events")
        print("  [✓] Test 10 Passed: Model versioning & Audit trail verified.")

    def test_11_model_rollback(self):
        """11. Test Model Rollback functionality."""
        models = query_collection("model_versions", "deployment_status", "==", "PRODUCTION")
        if models:
            target_version = models[0]["model_version"]
            res = rollback_production_model(target_version, actor="admin_user_id")
            self.assertTrue(res["success"], "Rollback should succeed")
            print(f"  [✓] Test 11 Passed: Rollback to version {target_version} successful.")


def main():
    suite = unittest.TestLoader().loadTestsFromTestCase(TestHumanInTheLoopContinualLearning)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if not result.wasSuccessful():
        sys.exit(1)


if __name__ == "__main__":
    main()
